/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import * as aria from '../../../../base/browser/ui/aria/aria.js';
import { MessageType } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { IIdentityProvider } from '../../../../base/browser/ui/list/list.js';
import { IAsyncDataSource, ITreeContextMenuEvent, ObjectTreeElementCollapseState } from '../../../../base/browser/ui/tree/tree.js';
import { Delayer, RunOnceScheduler, Throttler } from '../../../../base/common/async.js';
import * as errors from '../../../../base/common/errors.js';
import { Event } from '../../../../base/common/event.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { isLinux } from '../../../../base/common/platform.js';
import * as strings from '../../../../base/common/strings.js';
import { URI } from '../../../../base/common/uri.js';
import './media/searchview.css';
import { getCodeEditor, isCodeEditor, isDiffEditor } from '../../../../editor/browser/editorBrowser.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { EmbeddedCodeEditorWidget } from '../../../../editor/browser/widget/codeEditor/embeddedCodeEditorWidget.js';
import { IEditorOptions } from '../../../../editor/common/config/editorOptions.js';
import { Selection } from '../../../../editor/common/core/selection.js';
import { IEditor } from '../../../../editor/common/editorCommon.js';
import { CommonFindController } from '../../../../editor/contrib/find/browser/findController.js';
import { MultiCursorSelectionController } from '../../../../editor/contrib/multicursor/browser/multicursor.js';
import * as nls from '../../../../nls.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationChangeEvent, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfirmation, IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { FileChangesEvent, FileChangeType, IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { getSelectionKeyboardEvent, WorkbenchCompressibleAsyncDataTree } from '../../../../platform/list/browser/listService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IOpenerService, withSelection } from '../../../../platform/opener/common/opener.js';
import { IProgress, IProgressService, IProgressStep } from '../../../../platform/progress/common/progress.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { defaultInputBoxStyles, defaultToggleStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { IFileIconTheme, IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ResourceListDnDHandler } from '../../../browser/dnd.js';
import { ResourceLabels } from '../../../browser/labels.js';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IEditorPane } from '../../../common/editor.js';
import { Memento } from '../../../common/memento.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IFindInFilesArgs } from './searchActionsBase.js';
import { renderSearchMessage } from './searchMessage.js';
import { FileMatchRenderer, FolderMatchRenderer, MatchRenderer, SearchAccessibilityProvider, SearchDelegate, TextSearchResultRenderer } from './searchResultsView.js';
import { SearchWidget } from './searchWidget.js';
import * as Constants from '../common/constants.js';
import { IReplaceService } from './replace.js';
import { getOutOfWorkspaceEditorResources, SearchStateKey, SearchUIState } from '../common/search.js';
import { ISearchHistoryService, ISearchHistoryValues, SearchHistoryService } from '../common/searchHistoryService.js';
import { ACTIVE_GROUP, IEditorService, SIDE_GROUP } from '../../../services/editor/common/editorService.js';
import { IPreferencesService, ISettingsEditorOptions } from '../../../services/preferences/common/preferences.js';
import { ITextQueryBuilderOptions, QueryBuilder } from '../../../services/search/common/queryBuilder.js';
import { IPatternInfo, ISearchComplete, ISearchConfiguration, ISearchConfigurationProperties, ITextQuery, SearchCompletionExitCode, SearchSortOrder, TextSearchCompleteMessageType, ViewMode } from '../../../services/search/common/search.js';
import { AISearchKeyword, TextSearchCompleteMessage } from '../../../services/search/common/searchExtTypes.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { AccessibilitySignal, IAccessibilitySignalService } from '../../../../platform/accessibilitySignal/browser/accessibilitySignalService.js';
import { getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ISearchViewModelWorkbenchService } from './searchTreeModel/searchViewModelWorkbenchService.js';
import { SearchModelImpl } from './searchTreeModel/searchModel.js';
import { ISearchTreeMatch, isSearchTreeMatch, RenderableMatch, SearchModelLocation, IChangeEvent, FileMatchOrMatch, ISearchTreeFileMatch, ISearchTreeFolderMatch, ISearchModel, ISearchResult, isSearchTreeFileMatch, isSearchTreeFolderMatch, isSearchTreeFolderMatchNoRoot, isSearchTreeFolderMatchWithResource, isSearchTreeFolderMatchWorkspaceRoot, isSearchResult, isTextSearchHeading, ITextSearchHeading, isSearchHeader } from './searchTreeModel/searchTreeCommon.js';
import { searchMatchComparer } from './searchCompare.js';
import { AIFolderMatchWorkspaceRootImpl } from './AISearch/aiSearchModel.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { forcedExpandRecursively } from './searchActionsTopBar.js';

const $ = dom.$;

export enum SearchViewPosition {
	SideBar,
	Panel
}

// Vacha: query state (pattern, replace text, toggles) is per-file and in-memory
// only — deliberately NOT persisted across restarts. Only genuinely view-level
// bits survive in the memento.
interface ISearchViewState {
	view?: {
		showReplace?: boolean;
		treeLayout?: boolean;
	};
}

/**
 * Vacha: everything the Search pane shows for one file — widget state plus the
 * retained result model (undefined while the file has no results to keep).
 */
interface IPerFileSearchState {
	query: string;
	replaceText: string;
	isRegex: boolean;
	isCaseSensitive: boolean;
	isWholeWords: boolean;
	preserveCase: boolean;
	replaceShown: boolean;
	model: ISearchModel | undefined;
}

const SEARCH_CANCELLED_MESSAGE = nls.localize('searchCanceled', "Search was canceled before any results could be found - ");
const DEBOUNCE_DELAY = 75;
export class SearchView extends ViewPane {

	private static readonly ACTIONS_RIGHT_CLASS_NAME = 'actions-right';

	private isDisposed = false;

	private container!: HTMLElement;
	private queryBuilder: QueryBuilder;
	private viewModel: ISearchModel;
	private memento: Memento<ISearchViewState>;

	private viewletVisible: IContextKey<boolean>;
	private inputBoxFocused: IContextKey<boolean>;
	private firstMatchFocused: IContextKey<boolean>;
	private fileMatchOrMatchFocused: IContextKey<boolean>;
	private fileMatchOrFolderMatchFocus: IContextKey<boolean>;
	private fileMatchOrFolderMatchWithResourceFocus: IContextKey<boolean>;
	private fileMatchFocused: IContextKey<boolean>;
	private folderMatchFocused: IContextKey<boolean>;
	private folderMatchWithResourceFocused: IContextKey<boolean>;
	private matchFocused: IContextKey<boolean>;
	private searchResultHeaderFocused: IContextKey<boolean>;
	private isEditableItem: IContextKey<boolean>;
	private hasSearchResultsKey: IContextKey<boolean>;
	private lastFocusState: 'input' | 'tree' = 'input';

	private searchStateKey: IContextKey<SearchUIState>;
	private hasSearchPatternKey: IContextKey<boolean>;
	private hasReplacePatternKey: IContextKey<boolean>;
	private hasSomeCollapsibleResultKey: IContextKey<boolean>;

	private tree!: WorkbenchCompressibleAsyncDataTree<ISearchResult, RenderableMatch>;
	private treeLabels!: ResourceLabels;
	private viewletState: ISearchViewState;
	private messagesElement!: HTMLElement;
	private readonly messageDisposables: DisposableStore = new DisposableStore();
	private searchWidgetsContainerElement!: HTMLElement;
	private searchWidget!: SearchWidget;
	private size!: dom.Dimension;

	// Vacha: in the single Explorer pane the Search accordion collapses to just
	// its input widgets when there are no results and grows once a search runs.
	private didAutoExpandForResults = false;
	private autoExpanding = false;
	private readonly relaxAutoHeightFloor = this._register(new MutableDisposable<IDisposable>());
	private resultsElement!: HTMLElement;

	// Vacha: per-file Search pane state — each open file keeps its own query,
	// options, and result model; switching tabs swaps the whole pane content.
	// In-memory only (discarded on restart), capped LRU-style.
	private static readonly MAX_PER_FILE_SEARCH_STATES = 20;
	private readonly perFileSearchState = new Map<string /* URI.toString() */, IPerFileSearchState>();
	private currentStateKey: string | undefined;

	private currentSelectedFileMatch: ISearchTreeFileMatch | undefined;
	private readonly currentEditorCursorListener = this._register(new MutableDisposable());

	private delayedRefresh: Delayer<void>;
	private changedWhileHidden: boolean;

	private currentSearchQ = Promise.resolve();
	private addToSearchHistoryDelayer: Delayer<void>;

	private toggleCollapseStateDelayer: Delayer<void>;

	private triggerQueryDelayer: Delayer<void>;
	private pauseSearching = false;

	private treeAccessibilityProvider: SearchAccessibilityProvider;

	private treeViewKey: IContextKey<boolean>;

	private _visibleMatches: number = 0;

	private _refreshResultsScheduler: RunOnceScheduler;

	private _onSearchResultChangedDisposable: IDisposable | undefined;
	private _onAIResultChangedDisposable: IDisposable | undefined;

	private searchDataSource: SearchViewDataSource | undefined;

	private refreshTreeController: RefreshTreeController;

	private _cachedResults: ISearchComplete | undefined;
	private _cachedKeywords: string[] = [];
	public _pendingSemanticSearchPromise: Promise<ISearchComplete> | undefined;
	constructor(
		options: IViewPaneOptions,
		@IFileService private readonly fileService: IFileService,
		@IEditorService private readonly editorService: IEditorService,
		@ICodeEditorService private readonly codeEditorService: ICodeEditorService,
		@IProgressService private readonly progressService: IProgressService,
		@INotificationService private readonly notificationService: INotificationService,
		@IDialogService private readonly dialogService: IDialogService,
		@ICommandService private readonly commandService: ICommandService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IConfigurationService configurationService: IConfigurationService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@ISearchViewModelWorkbenchService private readonly searchViewModelWorkbenchService: ISearchViewModelWorkbenchService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IReplaceService private readonly replaceService: IReplaceService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IPreferencesService private readonly preferencesService: IPreferencesService,
		@IThemeService themeService: IThemeService,
		@ISearchHistoryService private readonly searchHistoryService: ISearchHistoryService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IStorageService private readonly storageService: IStorageService,
		@IOpenerService openerService: IOpenerService,
		@IHoverService hoverService: IHoverService,
		@ILogService private readonly logService: ILogService,
		@IAccessibilitySignalService private readonly accessibilitySignalService: IAccessibilitySignalService,
		@ITelemetryService telemetryService: ITelemetryService,
	) {

		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		this.container = dom.$('.search-view');

		// globals
		this.viewletVisible = Constants.SearchContext.SearchViewVisibleKey.bindTo(this.contextKeyService);
		this.firstMatchFocused = Constants.SearchContext.FirstMatchFocusKey.bindTo(this.contextKeyService);
		this.fileMatchOrMatchFocused = Constants.SearchContext.FileMatchOrMatchFocusKey.bindTo(this.contextKeyService);
		this.fileMatchOrFolderMatchFocus = Constants.SearchContext.FileMatchOrFolderMatchFocusKey.bindTo(this.contextKeyService);
		this.fileMatchOrFolderMatchWithResourceFocus = Constants.SearchContext.FileMatchOrFolderMatchWithResourceFocusKey.bindTo(this.contextKeyService);
		this.fileMatchFocused = Constants.SearchContext.FileFocusKey.bindTo(this.contextKeyService);
		this.folderMatchFocused = Constants.SearchContext.FolderFocusKey.bindTo(this.contextKeyService);
		this.folderMatchWithResourceFocused = Constants.SearchContext.ResourceFolderFocusKey.bindTo(this.contextKeyService);
		this.searchResultHeaderFocused = Constants.SearchContext.SearchResultHeaderFocused.bindTo(this.contextKeyService);
		this.hasSearchResultsKey = Constants.SearchContext.HasSearchResults.bindTo(this.contextKeyService);
		this.matchFocused = Constants.SearchContext.MatchFocusKey.bindTo(this.contextKeyService);
		this.searchStateKey = SearchStateKey.bindTo(this.contextKeyService);
		this.hasSearchPatternKey = Constants.SearchContext.ViewHasSearchPatternKey.bindTo(this.contextKeyService);
		this.hasReplacePatternKey = Constants.SearchContext.ViewHasReplacePatternKey.bindTo(this.contextKeyService);
		this.hasSomeCollapsibleResultKey = Constants.SearchContext.ViewHasSomeCollapsibleKey.bindTo(this.contextKeyService);
		this.treeViewKey = Constants.SearchContext.InTreeViewKey.bindTo(this.contextKeyService);
		this.refreshTreeController = this._register(this.instantiationService.createInstance(RefreshTreeController, this, () => this.searchConfig));

		this._register(this.contextKeyService.onDidChangeContext(e => {
			const keys = Constants.SearchContext.hasAIResultProvider.keys();
			if (e.affectsSome(new Set(keys))) {
				this.refreshHasAISetting();
			}
		}));

		// scoped
		this.contextKeyService = this._register(this.contextKeyService.createScoped(this.container));
		Constants.SearchContext.SearchViewFocusedKey.bindTo(this.contextKeyService).set(true);
		this.inputBoxFocused = Constants.SearchContext.InputBoxFocusedKey.bindTo(this.contextKeyService);
		this.isEditableItem = Constants.SearchContext.IsEditableItemKey.bindTo(this.contextKeyService);

		this.instantiationService = this._register(this.instantiationService.createChild(
			new ServiceCollection([IContextKeyService, this.contextKeyService])));

		this._register(this.configurationService.onDidChangeConfiguration(async e => {
			if (e.affectsConfiguration('search.sortOrder')) {
				if (this.searchConfig.sortOrder === SearchSortOrder.Modified) {
					// If changing away from modified, remove all fileStats
					// so that updated files are re-retrieved next time.
					this.removeFileStats();
				}
				await this.refreshTreeController.queue();
			}
		}));

		this.viewModel = this.searchViewModelWorkbenchService.searchModel;
		this.queryBuilder = this.instantiationService.createInstance(QueryBuilder);
		this.memento = new Memento(this.id, storageService);
		this.viewletState = this.memento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);

		this._register(this.fileService.onDidFilesChange(e => this.onFilesChanged(e)));
		this._register(this.textFileService.untitled.onWillDispose(model => this.onUntitledDidDispose(model.resource)));
		this._register(this.searchHistoryService.onDidClearHistory(() => this.clearHistory()));
		this._register(this.configurationService.onDidChangeConfiguration(e => this.onConfigurationUpdated(e)));

		this.delayedRefresh = this._register(new Delayer<void>(250));

		this.addToSearchHistoryDelayer = this._register(new Delayer<void>(2000));
		this.toggleCollapseStateDelayer = this._register(new Delayer<void>(100));
		this.triggerQueryDelayer = this._register(new Delayer<void>(0));

		this.treeAccessibilityProvider = this.instantiationService.createInstance(SearchAccessibilityProvider, this);
		this.isTreeLayoutViewVisible = this.viewletState.view?.treeLayout ?? (this.searchConfig.defaultViewMode === ViewMode.Tree);

		this._refreshResultsScheduler = this._register(new RunOnceScheduler(this._updateResults.bind(this), 80));

		// storage service listener for for roaming changes
		this._register(this.storageService.onWillSaveState(() => {
			this._saveSearchHistoryService();
		}));

		this._register(this.storageService.onDidChangeValue(StorageScope.WORKSPACE, SearchHistoryService.SEARCH_HISTORY_KEY, this._store)(() => {
			const restoredHistory = this.searchHistoryService.load();

			if (restoredHistory.search) {
				this.searchWidget.prependSearchHistory(restoredHistory.search);
			}
			if (restoredHistory.replace) {
				this.searchWidget.prependReplaceHistory(restoredHistory.replace);
			}
		}));

		this.changedWhileHidden = this.hasSearchResults();
	}

	public get cachedResults() {
		return this._cachedResults;
	}

	async queueRefreshTree(): Promise<void> {
		return this.refreshTreeController.queue();
	}
	get isTreeLayoutViewVisible(): boolean {
		return this.treeViewKey.get() ?? false;
	}

	private set isTreeLayoutViewVisible(visible: boolean) {
		this.treeViewKey.set(visible);
	}

	async setTreeView(visible: boolean): Promise<void> {
		if (visible === this.isTreeLayoutViewVisible) {
			return;
		}
		this.isTreeLayoutViewVisible = visible;
		this.updateIndentStyles(this.themeService.getFileIconTheme());
		return this.refreshTreeController.queue();
	}

	private get state(): SearchUIState {
		return this.searchStateKey.get() ?? SearchUIState.Idle;
	}

	private set state(v: SearchUIState) {
		this.searchStateKey.set(v);
	}

	getContainer(): HTMLElement {
		return this.container;
	}

	get searchResult(): ISearchResult {
		return this.viewModel && this.viewModel.searchResult;
	}

	get model(): ISearchModel {
		return this.viewModel;
	}

	private async refreshHasAISetting(): Promise<void> {
		const shouldShowAI = this.shouldShowAIResults();
		if (!this.tree || !this.tree.hasNode(this.searchResult)) {
			return;
		}
		if (shouldShowAI && !this.tree.hasNode(this.searchResult.aiTextSearchResult)) {
			if (this.model.searchResult.getCachedSearchComplete(false)) {
				return this.refreshAndUpdateCount();
			}
		} else if (!shouldShowAI && this.tree.hasNode(this.searchResult.aiTextSearchResult)) {
			return this.refreshAndUpdateCount();
		}
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		this.container = dom.append(parent, dom.$('.search-view'));

		this.searchWidgetsContainerElement = dom.append(this.container, $('.search-widgets-container'));
		this.createSearchWidget(this.searchWidgetsContainerElement);

		// Vacha: no include/exclude ('query details') UI — the search scope is
		// always the active file, so those inputs cannot do anything here.

		this.messagesElement = dom.append(this.container, $('.messages.text-search-provider-messages'));

		this.createSearchResultsView(this.container);

		// Vacha: per-file search state starts keyed to whichever file is active
		this.currentStateKey = this.editorService.activeEditor?.resource?.toString();

		this._onSearchResultChangedDisposable = this._register(this.viewModel.onSearchResultChanged(async (event) => await this.onSearchResultsChanged(event)));

		// Subscribe to AI search result changes and update the tree when new AI results are reported
		this._onAIResultChangedDisposable?.dispose();
		this._onAIResultChangedDisposable = this._register(
			this.viewModel.searchResult.aiTextSearchResult.onChange((e) => {
				// Only refresh the AI node, not the whole tree
				if (this.tree && this.tree.hasNode(this.searchResult.aiTextSearchResult) && !e.removed) {
					this.tree.updateChildren(this.searchResult.aiTextSearchResult);
				}
			})
		);

		this._register(this.onDidChangeBodyVisibility(visible => this.onVisibilityChanged(visible)));

		this.updateIndentStyles(this.themeService.getFileIconTheme());
		this._register(this.themeService.onDidFileIconThemeChange(this.updateIndentStyles, this));
	}

	private updateIndentStyles(theme: IFileIconTheme): void {
		this.resultsElement.classList.toggle('hide-arrows', this.isTreeLayoutViewVisible && theme.hidesExplorerArrows);
	}

	private async onVisibilityChanged(visible: boolean): Promise<void> {
		this.viewletVisible.set(visible);
		if (visible) {
			if (this.changedWhileHidden) {
				// Render if results changed while viewlet was hidden - #37818
				await this.refreshAndUpdateCount();
				this.changedWhileHidden = false;
			}
		} else {
			// Reset last focus to input to preserve opening the viewlet always focusing the query editor.
			this.lastFocusState = 'input';
		}

		// Enable highlights if there are searchresults
		this.viewModel?.searchResult.toggleHighlights(visible);
	}

	get searchAndReplaceWidget(): SearchWidget {
		return this.searchWidget;
	}

	private createSearchWidget(container: HTMLElement): void {
		// Vacha: the query itself (pattern, replace text, toggles) is per-file
		// and in-memory only — the widgets always start empty after a restart.
		const history = this.searchHistoryService.load();
		const searchHistory = history.search || [];
		const replaceHistory = history.replace || [];
		const showReplace = typeof this.viewletState.view?.showReplace === 'boolean' ? this.viewletState.view.showReplace : true;

		this.searchWidget = this._register(this.instantiationService.createInstance(SearchWidget, container, {
			value: '',
			replaceValue: '',
			isRegex: false,
			isCaseSensitive: false,
			isWholeWords: false,
			searchHistory: searchHistory,
			replaceHistory: replaceHistory,
			preserveCase: false,
			inputBoxStyles: defaultInputBoxStyles,
			toggleStyles: defaultToggleStyles,
		}));

		if (!this.searchWidget.searchInput || !this.searchWidget.replaceInput) {
			this.logService.warn(`Cannot fully create search widget. Search or replace input undefined. SearchInput: ${this.searchWidget.searchInput}, ReplaceInput: ${this.searchWidget.replaceInput}`);
			return;
		}

		if (showReplace) {
			this.searchWidget.toggleReplace(true);
		}

		this._register(this.searchWidget.onSearchSubmit(options => {
			// Vacha: semantic/AI search is removed - always a plain text query.
			this.triggerQueryChange({
				...options,
				shouldKeepAIResults: false,
			});
		}));
		this._register(this.searchWidget.onSearchCancel(({ focus }) => this.cancelSearch(focus)));
		this._register(this.searchWidget.searchInput.onDidOptionChange(() => {
			this.triggerQueryChange({ shouldKeepAIResults: true });
		}));

		const updateHasPatternKey = () => this.hasSearchPatternKey.set(this.searchWidget.searchInput ? (this.searchWidget.searchInput.getValue().length > 0) : false);
		updateHasPatternKey();
		this._register(this.searchWidget.searchInput.onDidChange(() => updateHasPatternKey()));

		const updateHasReplacePatternKey = () => this.hasReplacePatternKey.set(this.searchWidget.getReplaceValue().length > 0);
		updateHasReplacePatternKey();
		this._register(this.searchWidget.replaceInput.inputBox.onDidChange(() => updateHasReplacePatternKey()));

		this._register(this.searchWidget.onDidHeightChange(() => this.reLayout()));

		this._register(this.searchWidget.onReplaceToggled(() => this.reLayout()));
		this._register(this.searchWidget.onReplaceStateChange(async (state) => {
			this.viewModel.replaceActive = state;
			await this.refreshTreeController.queue();
		}));

		this._register(this.searchWidget.onPreserveCaseChange(async (state) => {
			this.viewModel.preserveCase = state;
			await this.refreshTreeController.queue();
		}));

		this._register(this.searchWidget.onReplaceValueChanged(() => {
			this.viewModel.replaceString = this.searchWidget.getReplaceValue();
			this.delayedRefresh.trigger(async () => this.refreshTreeController.queue());
		}));

		this._register(this.searchWidget.onReplaceAll(() => this.replaceAll()));

		this.trackInputBox(this.searchWidget.searchInputFocusTracker);
		this.trackInputBox(this.searchWidget.replaceInputFocusTracker);
	}

	public shouldShowAIResults(): boolean {
		const hasProvider = Constants.SearchContext.hasAIResultProvider.getValue(this.contextKeyService);
		return !!hasProvider;
	}
	private async onConfigurationUpdated(event?: IConfigurationChangeEvent): Promise<void> {
		if (event && (event.affectsConfiguration('search.decorations.colors') || event.affectsConfiguration('search.decorations.badges'))) {
			return this.refreshTreeController.queue();
		}
	}

	private trackInputBox(inputFocusTracker: dom.IFocusTracker | undefined): void {
		if (!inputFocusTracker) {
			return;
		}

		this._register(inputFocusTracker.onDidFocus(() => {
			this.lastFocusState = 'input';
			this.inputBoxFocused.set(true);
		}));
		this._register(inputFocusTracker.onDidBlur(() => {
			this.inputBoxFocused.set(this.searchWidget.searchInputHasFocus()
				|| this.searchWidget.replaceInputHasFocus());
		}));
	}

	private async onSearchResultsChanged(event?: IChangeEvent): Promise<void> {
		if (this.isVisible()) {
			return this.refreshAndUpdateCount(event);
		} else {
			this.changedWhileHidden = true;
		}
	}

	private async refreshAndUpdateCount(event?: IChangeEvent): Promise<void> {
		this.searchWidget.setReplaceAllActionState(!this.viewModel.searchResult.isEmpty());
		this.updateSearchResultCount(event?.clearingAll);
		return this.refreshTreeController.queue(event);
	}

	private originalShouldCollapse(match: RenderableMatch) {
		const collapseResults = this.searchConfig.collapseResults;
		return (collapseResults === 'alwaysCollapse' ||
			(!(isSearchTreeMatch(match)) && match.count() > 10 && collapseResults !== 'alwaysExpand')) ?
			ObjectTreeElementCollapseState.PreserveOrCollapsed : ObjectTreeElementCollapseState.PreserveOrExpanded;
	}

	private shouldCollapseAccordingToConfig(match: RenderableMatch): boolean {
		const collapseResults = this.originalShouldCollapse(match);
		if (collapseResults === ObjectTreeElementCollapseState.PreserveOrCollapsed) {
			return true;
		}
		return false;
	}

	private replaceAll(): void {
		if (this.viewModel.searchResult.count() === 0) {
			return;
		}

		const occurrences = this.viewModel.searchResult.count();
		const fileCount = this.viewModel.searchResult.fileCount();
		const replaceValue = this.searchWidget.getReplaceValue() || '';
		const afterReplaceAllMessage = this.buildAfterReplaceAllMessage(occurrences, fileCount, replaceValue);

		let progressComplete: () => void;
		let progressReporter: IProgress<IProgressStep>;

		this.progressService.withProgress({ location: this.getProgressLocation(), delay: 100, total: occurrences }, p => {
			progressReporter = p;

			return new Promise<void>(resolve => progressComplete = resolve);
		});

		const confirmation: IConfirmation = {
			title: nls.localize('replaceAll.confirmation.title', "Replace All"),
			message: this.buildReplaceAllConfirmationMessage(occurrences, fileCount, replaceValue),
			primaryButton: nls.localize({ key: 'replaceAll.confirm.button', comment: ['&& denotes a mnemonic'] }, "&&Replace")
		};

		this.dialogService.confirm(confirmation).then(res => {
			if (res.confirmed) {
				this.searchWidget.setReplaceAllActionState(false);
				this.viewModel.searchResult.replaceAll(progressReporter).then(() => {
					progressComplete();
					const messageEl = this.clearMessage();
					dom.append(messageEl, afterReplaceAllMessage);
					this.reLayout();
				}, (error) => {
					progressComplete();
					errors.isCancellationError(error);
					this.notificationService.error(error);
				});
			} else {
				progressComplete();
			}
		});
	}

	private buildAfterReplaceAllMessage(occurrences: number, fileCount: number, replaceValue?: string) {
		if (occurrences === 1) {
			if (fileCount === 1) {
				if (replaceValue) {
					return nls.localize('replaceAll.occurrence.file.message', "Replaced {0} occurrence across {1} file with '{2}'.", occurrences, fileCount, replaceValue);
				}

				return nls.localize('removeAll.occurrence.file.message', "Replaced {0} occurrence across {1} file.", occurrences, fileCount);
			}

			if (replaceValue) {
				return nls.localize('replaceAll.occurrence.files.message', "Replaced {0} occurrence across {1} files with '{2}'.", occurrences, fileCount, replaceValue);
			}

			return nls.localize('removeAll.occurrence.files.message', "Replaced {0} occurrence across {1} files.", occurrences, fileCount);
		}

		if (fileCount === 1) {
			if (replaceValue) {
				return nls.localize('replaceAll.occurrences.file.message', "Replaced {0} occurrences across {1} file with '{2}'.", occurrences, fileCount, replaceValue);
			}

			return nls.localize('removeAll.occurrences.file.message', "Replaced {0} occurrences across {1} file.", occurrences, fileCount);
		}

		if (replaceValue) {
			return nls.localize('replaceAll.occurrences.files.message', "Replaced {0} occurrences across {1} files with '{2}'.", occurrences, fileCount, replaceValue);
		}

		return nls.localize('removeAll.occurrences.files.message', "Replaced {0} occurrences across {1} files.", occurrences, fileCount);
	}

	private buildReplaceAllConfirmationMessage(occurrences: number, fileCount: number, replaceValue?: string) {
		// Helper to truncate long values to 10 lines max
		const truncateValue = (value: string | undefined): string | undefined => {
			if (!value) {
				return value;
			}
			const lines = value.split('\n');
			if (lines.length > 10) {
				return lines.slice(0, 10).join('\n') + '\n...';
			}
			return value;
		};

		const displayReplaceValue = truncateValue(replaceValue);

		if (occurrences === 1) {
			if (fileCount === 1) {
				if (displayReplaceValue) {
					return nls.localize('removeAll.occurrence.file.confirmation.message', "Replace {0} occurrence across {1} file with '{2}'?", occurrences, fileCount, displayReplaceValue);
				}

				return nls.localize('replaceAll.occurrence.file.confirmation.message', "Replace {0} occurrence across {1} file?", occurrences, fileCount);
			}

			if (displayReplaceValue) {
				return nls.localize('removeAll.occurrence.files.confirmation.message', "Replace {0} occurrence across {1} files with '{2}'?", occurrences, fileCount, displayReplaceValue);
			}

			return nls.localize('replaceAll.occurrence.files.confirmation.message', "Replace {0} occurrence across {1} files?", occurrences, fileCount);
		}

		if (fileCount === 1) {
			if (displayReplaceValue) {
				return nls.localize('removeAll.occurrences.file.confirmation.message', "Replace {0} occurrences across {1} file with '{2}'?", occurrences, fileCount, displayReplaceValue);
			}

			return nls.localize('replaceAll.occurrences.file.confirmation.message', "Replace {0} occurrences across {1} file?", occurrences, fileCount);
		}

		if (displayReplaceValue) {
			return nls.localize('removeAll.occurrences.files.confirmation.message', "Replace {0} occurrences across {1} files with '{2}'?", occurrences, fileCount, displayReplaceValue);
		}

		return nls.localize('replaceAll.occurrences.files.confirmation.message', "Replace {0} occurrences across {1} files?", occurrences, fileCount);
	}

	private clearMessage(): HTMLElement {
		const wasHidden = this.messagesElement.style.display === 'none';
		dom.clearNode(this.messagesElement);
		dom.show(this.messagesElement);
		this.messageDisposables.clear();

		const newMessage = dom.append(this.messagesElement, $('.message'));
		if (wasHidden) {
			this.reLayout();
		}

		return newMessage;
	}

	private createSearchResultsView(container: HTMLElement): void {
		this.resultsElement = dom.append(container, $('.results.show-file-icons.file-icon-themable-tree'));
		const delegate = this.instantiationService.createInstance(SearchDelegate);

		const identityProvider: IIdentityProvider<RenderableMatch> = {
			getId(element: RenderableMatch) {
				return element.id();
			}
		};

		this.searchDataSource = this.instantiationService.createInstance(SearchViewDataSource, this);
		this.treeLabels = this._register(this.instantiationService.createInstance(ResourceLabels, { onDidChangeVisibility: this.onDidChangeBodyVisibility }));
		this.tree = this._register(this.instantiationService.createInstance(WorkbenchCompressibleAsyncDataTree<ISearchResult, RenderableMatch>,
			'SearchView',
			this.resultsElement,
			delegate,
			{
				isIncompressible: (element: RenderableMatch) => {

					if (isSearchTreeFolderMatch(element) && !isTextSearchHeading(element.parent()) && !(isSearchTreeFolderMatchWorkspaceRoot(element.parent())) && !(isSearchTreeFolderMatchNoRoot(element.parent()))) {
						return false;
					}
					return true;
				}
			},
			[
				this._register(this.instantiationService.createInstance(FolderMatchRenderer, this, this.treeLabels)),
				this._register(this.instantiationService.createInstance(FileMatchRenderer, this, this.treeLabels)),
				this._register(this.instantiationService.createInstance(TextSearchResultRenderer, this.treeLabels)),
				this._register(this.instantiationService.createInstance(MatchRenderer, this)),
			],
			this.searchDataSource,
			{
				identityProvider,
				accessibilityProvider: this.treeAccessibilityProvider,
				dnd: this.instantiationService.createInstance(ResourceListDnDHandler, element => {
					if (isSearchTreeFileMatch(element)) {
						return element.resource;
					}
					if (isSearchTreeMatch(element)) {
						return withSelection(element.parent().resource, element.range());
					}
					return null;
				}),
				multipleSelectionSupport: true,
				selectionNavigation: true,
				overrideStyles: this.getLocationBasedColors().listOverrideStyles,
				paddingBottom: SearchDelegate.ITEM_HEIGHT,
				collapseByDefault: (e: RenderableMatch) => {
					if (isTextSearchHeading(e)) {
						// always collapse the ai text search result, but always expand the text result
						return e.isAIContributed;
					}

					// always expand compressed nodes
					if (isSearchTreeFolderMatch(e) && e.matches().length === 1 && isSearchTreeFolderMatch(e.matches()[0])) {
						return false;
					}
					return this.shouldCollapseAccordingToConfig(e);
				}
			}));

		Constants.SearchContext.SearchResultListFocusedKey.bindTo(this.tree.contextKeyService);

		this.tree.setInput(this.viewModel.searchResult);
		this._register(this.tree.onContextMenu(e => this.onContextMenu(e)));
		const updateHasSomeCollapsible = () => this.toggleCollapseStateDelayer.trigger(() => this.hasSomeCollapsibleResultKey.set(this.hasSomeCollapsible()));
		updateHasSomeCollapsible();
		this._register(this.tree.onDidChangeCollapseState(() => updateHasSomeCollapsible()));
		this._register(this.tree.onDidChangeModel(() => updateHasSomeCollapsible()));

		this._register(Event.debounce(this.tree.onDidOpen, (last, event) => event, DEBOUNCE_DELAY, true)(options => {
			if (isSearchTreeMatch(options.element)) {
				const selectedMatch: ISearchTreeMatch = options.element;
				this.currentSelectedFileMatch?.setSelectedMatch(null);
				this.currentSelectedFileMatch = selectedMatch.parent();
				this.currentSelectedFileMatch.setSelectedMatch(selectedMatch);

				this.onFocus(selectedMatch, options.editorOptions.preserveFocus, options.sideBySide, options.editorOptions.pinned);
			}
		}));

		this._register(Event.debounce(this.tree.onDidChangeFocus, (last, event) => event, DEBOUNCE_DELAY, true)(() => {
			const selection = this.tree.getSelection();
			const focus = this.tree.getFocus()[0];
			if (selection.length > 1 && isSearchTreeMatch(focus)) {
				this.onFocus(focus, true);
			}
		}));

		this._register(Event.any<any>(this.tree.onDidFocus, this.tree.onDidChangeFocus)(() => {
			const focus = this.tree.getFocus()[0];

			if (this.tree.isDOMFocused()) {
				const firstElem = this.tree.getFirstElementChild(this.tree.getInput());
				this.firstMatchFocused.set(firstElem === focus);
				this.fileMatchOrMatchFocused.set(!!focus);
				this.fileMatchFocused.set(isSearchTreeFileMatch(focus));
				this.folderMatchFocused.set(isSearchTreeFolderMatch(focus));
				this.matchFocused.set(isSearchTreeMatch(focus));
				this.fileMatchOrFolderMatchFocus.set(isSearchTreeFileMatch(focus) || isSearchTreeFolderMatch(focus));
				this.fileMatchOrFolderMatchWithResourceFocus.set(isSearchTreeFileMatch(focus) || isSearchTreeFolderMatchWithResource(focus));
				this.folderMatchWithResourceFocused.set(isSearchTreeFolderMatchWithResource(focus));
				this.searchResultHeaderFocused.set(isSearchHeader(focus));
				this.lastFocusState = 'tree';
			}

			let editable = false;
			if (isSearchTreeMatch(focus)) {
				editable = !focus.isReadonly;
			} else if (isSearchTreeFileMatch(focus)) {
				editable = !focus.hasOnlyReadOnlyMatches();
			} else if (isSearchTreeFolderMatch(focus)) {
				editable = !focus.hasOnlyReadOnlyMatches();
			}
			this.isEditableItem.set(editable);
		}));

		this._register(this.tree.onDidBlur(() => {
			this.firstMatchFocused.reset();
			this.fileMatchOrMatchFocused.reset();
			this.fileMatchFocused.reset();
			this.folderMatchFocused.reset();
			this.matchFocused.reset();
			this.fileMatchOrFolderMatchFocus.reset();
			this.fileMatchOrFolderMatchWithResourceFocus.reset();
			this.folderMatchWithResourceFocused.reset();
			this.searchResultHeaderFocused.reset();
			this.isEditableItem.reset();
		}));

		// Setup cursor position monitoring to clear selected match when cursor moves
		this._register(this.editorService.onDidActiveEditorChange(() => {
			// Vacha: swap the pane to the newly active file's own search state
			this.onActiveEditorChangedForSearchState();

			const editor = getCodeEditor(this.editorService.activeTextEditorControl);
			this.currentEditorCursorListener.value = editor?.onDidChangeCursorPosition(() => {
				this.currentSelectedFileMatch?.setSelectedMatch(null);
				this.currentSelectedFileMatch = undefined;
			});
		}));
	}

	private onContextMenu(e: ITreeContextMenuEvent<RenderableMatch | null>): void {

		e.browserEvent.preventDefault();
		e.browserEvent.stopPropagation();
		const selection = this.tree.getSelection();
		let arg: any;
		let context: any;
		if (selection && selection.length > 0) {
			arg = e.element;
			context = selection;
		} else {
			context = e.element;
		}

		this.contextMenuService.showContextMenu({
			menuId: MenuId.SearchContext,
			menuActionOptions: { shouldForwardArgs: true, arg },
			contextKeyService: this.contextKeyService,
			getAnchor: () => e.anchor,
			getActionsContext: () => context,
		});
	}

	private hasSomeCollapsible(): boolean {
		const viewer = this.getControl();
		const navigator = viewer.navigate();
		let node = navigator.first();
		const shouldShowAI = this.shouldShowAIResults();
		do {
			if (node && !viewer.isCollapsed(node) && (!shouldShowAI || !(isTextSearchHeading(node)))) {
				// ignore the ai text search result id
				return true;
			}
		} while (node = navigator.next());

		return false;
	}

	async selectNextMatch(): Promise<void> {
		if (!this.hasSearchResults()) {
			return;
		}

		const [selected] = this.tree.getSelection();

		// Expand the initial selected node, if needed
		if (selected && !(isSearchTreeMatch(selected))) {
			if (this.tree.isCollapsed(selected)) {
				await this.tree.expand(selected);
			}
		}

		const navigator = this.tree.navigate(selected);

		let next = navigator.next();
		if (!next) {
			next = navigator.first();
		}

		// Expand until first child is a Match
		while (next && !(isSearchTreeMatch(next))) {
			if (this.tree.isCollapsed(next)) {
				await this.tree.expand(next);
			}

			// Select the first child
			next = navigator.next();
		}

		// Reveal the newly selected element
		if (next) {
			if (next === selected) {
				this.tree.setFocus([]);
			}
			const event = getSelectionKeyboardEvent(undefined, false, false);
			this.tree.setFocus([next], event);
			this.tree.setSelection([next], event);
			this.tree.reveal(next);
			const ariaLabel = this.treeAccessibilityProvider.getAriaLabel(next);
			if (ariaLabel) { aria.status(ariaLabel); }
		}
	}

	async selectPreviousMatch(): Promise<void> {
		if (!this.hasSearchResults()) {
			return;
		}

		const [selected] = this.tree.getSelection();
		let navigator = this.tree.navigate(selected);

		let prev = navigator.previous();

		// Select previous until find a Match or a collapsed item
		while (!prev || (!(isSearchTreeMatch(prev)) && !this.tree.isCollapsed(prev))) {
			const nextPrev = prev ? navigator.previous() : navigator.last();

			if (!prev && !nextPrev) {
				return;
			}

			prev = nextPrev;
		}

		// Expand until last child is a Match
		while (prev && !(isSearchTreeMatch(prev))) {
			const nextItem = navigator.next();
			if (!nextItem) {
				break;
			}
			await this.tree.expand(prev);
			navigator = this.tree.navigate(nextItem); // recreate navigator because modifying the tree can invalidate it
			prev = nextItem ? navigator.previous() : navigator.last(); // select last child
		}

		// Reveal the newly selected element
		if (prev) {
			if (prev === selected) {
				this.tree.setFocus([]);
			}
			const event = getSelectionKeyboardEvent(undefined, false, false);
			this.tree.setFocus([prev], event);
			this.tree.setSelection([prev], event);
			this.tree.reveal(prev);
			const ariaLabel = this.treeAccessibilityProvider.getAriaLabel(prev);
			if (ariaLabel) { aria.status(ariaLabel); }
		}
	}

	moveFocusToResults(): void {
		this.tree.domFocus();
	}

	override focus(): void {
		super.focus();
		if (this.lastFocusState === 'input' || !this.hasSearchResults()) {
			const updatedText = this.searchConfig.seedOnFocus ? this.updateTextFromSelection({ allowSearchOnType: false }) : false;
			this.searchWidget.focus(undefined, undefined, updatedText);
		} else {
			this.tree.domFocus();
		}
	}

	updateTextFromFindWidgetOrSelection({ allowUnselectedWord = true, allowSearchOnType = true }): boolean {
		let activeEditor = this.editorService.activeTextEditorControl;
		if (isCodeEditor(activeEditor) && !activeEditor?.hasTextFocus()) {
			const controller = CommonFindController.get(activeEditor);
			if (controller && controller.isFindInputFocused()) {
				return this.updateTextFromFindWidget(controller, { allowSearchOnType });
			}

			const editors = this.codeEditorService.listCodeEditors();
			activeEditor = editors.find(editor => editor instanceof EmbeddedCodeEditorWidget && editor.getParentEditor() === activeEditor && editor.hasTextFocus())
				?? activeEditor;
		}

		return this.updateTextFromSelection({ allowUnselectedWord, allowSearchOnType }, activeEditor);
	}

	private updateTextFromFindWidget(controller: CommonFindController, { allowSearchOnType = true }): boolean {
		if (!this.searchConfig.seedWithNearestWord && (dom.getActiveWindow().getSelection()?.toString() ?? '') === '') {
			return false;
		}

		const searchString = controller.getState().searchString;
		if (searchString === '') {
			return false;
		}

		this.searchWidget.searchInput?.setCaseSensitive(controller.getState().matchCase);
		this.searchWidget.searchInput?.setWholeWords(controller.getState().wholeWord);
		this.searchWidget.searchInput?.setRegex(controller.getState().isRegex);
		this.updateText(searchString, allowSearchOnType);

		return true;
	}

	private updateTextFromSelection({ allowUnselectedWord = true, allowSearchOnType = true }, editor?: IEditor): boolean {
		const seedSearchStringFromSelection = this.configurationService.getValue<IEditorOptions>('editor').find!.seedSearchStringFromSelection;
		if (!seedSearchStringFromSelection || seedSearchStringFromSelection === 'never') {
			return false;
		}

		let selectedText = this.getSearchTextFromEditor(allowUnselectedWord, editor);
		if (selectedText === null) {
			return false;
		}

		if (this.searchWidget.searchInput?.getRegex()) {
			selectedText = strings.escapeRegExpCharacters(selectedText);
		}

		this.updateText(selectedText, allowSearchOnType);
		return true;
	}

	private updateText(text: string, allowSearchOnType: boolean = true) {
		if (allowSearchOnType && !this.viewModel.searchResult.isDirty) {
			this.searchWidget.setValue(text);
		} else {
			this.pauseSearching = true;
			this.searchWidget.setValue(text);
			this.pauseSearching = false;
		}
	}

	focusNextInputBox(): void {
		if (this.searchWidget.searchInputHasFocus()) {
			if (this.searchWidget.isReplaceShown()) {
				this.searchWidget.focus(true, true);
			} else {
				this.selectTreeIfNotSelected();
			}
			return;
		}

		if (this.searchWidget.replaceInputHasFocus()) {
			this.selectTreeIfNotSelected();
			return;
		}
	}

	focusPreviousInputBox(): void {
		if (this.searchWidget.searchInputHasFocus()) {
			return;
		}

		if (this.searchWidget.replaceInputHasFocus()) {
			this.searchWidget.focus(true);
			return;
		}

		if (this.tree.isDOMFocused()) {
			this.searchWidget.focus(true, true);
			return;
		}
	}

	private reLayout(): void {
		if (this.isDisposed || !this.size) {
			return;
		}

		const actionsPosition = this.searchConfig.actionsPosition;
		this.getContainer().classList.toggle(SearchView.ACTIONS_RIGHT_CLASS_NAME, actionsPosition === 'right');

		this.searchWidget.setWidth(this.size.width - 28 /* container margin */);

		const widgetHeight = dom.getTotalHeight(this.searchWidgetsContainerElement);
		const messagesHeight = dom.getTotalHeight(this.messagesElement);
		this.tree.layout(this.size.height - widgetHeight - messagesHeight, this.size.width - 28);

		this.applyAutoHeightConstraints();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.size = new dom.Dimension(width, height);
		this.reLayout();
	}

	/** Height needed to show the search/replace widgets, query details, and messages. */
	private searchWidgetsHeight(): number {
		return dom.getTotalHeight(this.searchWidgetsContainerElement) + dom.getTotalHeight(this.messagesElement);
	}

	/** True while the Search view shares its container with other accordions. */
	private sharesContainer(): boolean {
		const container = this.viewDescriptorService.getViewContainerByViewId(this.id);
		return !!container && this.viewDescriptorService.getViewContainerModel(container).visibleViewDescriptors.length > 1;
	}

	private setBodySizeConstraints(min: number, max: number): void {
		if (this.minimumBodySize !== min) {
			this.minimumBodySize = min;
		}
		if (this.maximumBodySize !== max) {
			this.maximumBodySize = max;
		}
	}

	/**
	 * Pins the Search accordion to its widgets' height while there is nothing to
	 * show, and releases it to grow once a search is running or has results.
	 * Only applies when sharing a container, so a stand-alone Search view keeps
	 * its normal sizing.
	 */
	private applyAutoHeightConstraints(): void {
		if (this.isDisposed || this.autoExpanding || !this.isBodyVisible() || !this.size || !this.sharesContainer()) {
			return;
		}
		const widgetsHeight = this.searchWidgetsHeight();
		if (widgetsHeight <= 0) {
			return; // not laid out yet — avoid pinning the pane to nothing
		}
		const active = this.hasSearchResults() || this.state !== SearchUIState.Idle;
		if (active) {
			this.setBodySizeConstraints(widgetsHeight, Number.POSITIVE_INFINITY);
		} else {
			this.didAutoExpandForResults = false;
			this.setBodySizeConstraints(widgetsHeight, widgetsHeight);
		}
	}

	/**
	 * On the first results after being pinned, briefly raises the size floor so
	 * the split view grows this accordion, then relaxes it so it stays resizable.
	 */
	private expandForResults(): void {
		if (this.isDisposed || !this.isBodyVisible() || !this.size || this.didAutoExpandForResults || !this.hasSearchResults() || !this.sharesContainer()) {
			return;
		}
		this.didAutoExpandForResults = true;
		this.autoExpanding = true;
		const widgetsHeight = this.searchWidgetsHeight();
		this.minimumBodySize = widgetsHeight + 240;
		this.maximumBodySize = Number.POSITIVE_INFINITY;
		this.relaxAutoHeightFloor.value = dom.scheduleAtNextAnimationFrame(dom.getWindow(this.container), () => {
			this.autoExpanding = false;
			if (!this.isDisposed && this.minimumBodySize !== widgetsHeight) {
				this.minimumBodySize = widgetsHeight;
			}
		});
	}

	/** Clears the search box, replace box, and results. */
	resetSearch(): void {
		this.searchWidget.clear();
		this.clearSearchResults(false);
		this.searchWidget.focus();
	}

	getControl() {
		return this.tree;
	}

	allSearchFieldsClear(): boolean {
		return this.searchWidget.getReplaceValue() === '' &&
			(!this.searchWidget.searchInput || this.searchWidget.searchInput.getValue() === '');
	}

	hasSearchResults(): boolean {
		return !this.viewModel.searchResult.isEmpty();
	}

	clearSearchResults(clearInput = true): void {
		this.viewModel.searchResult.clear();
		this.showEmptyStage(true);
		if (clearInput) {
			this.searchWidget.clear();
		}
		this.viewModel.cancelSearch();
		this.viewModel.cancelAISearch();
		// Vacha: clearing is a discard — drop the active file's cached state too
		if (this.currentStateKey !== undefined) {
			this.deleteSearchStateForFile(this.currentStateKey);
		}
		this.tree.ariaLabel = nls.localize('emptySearch', "Empty Search");

		this.accessibilitySignalService.playSignal(AccessibilitySignal.clear);
		this.reLayout();
	}

	cancelSearch(focus: boolean = true): boolean {
		if (this.viewModel.cancelSearch() && this.viewModel.cancelAISearch()) {
			if (focus) { this.searchWidget.focus(); }
			return true;
		}
		return false;
	}

	private selectTreeIfNotSelected(): void {
		if (this.tree.getNode(undefined)) {
			this.tree.domFocus();
			const selection = this.tree.getSelection();
			if (selection.length === 0) {
				const event = getSelectionKeyboardEvent();
				this.tree.focusNext(undefined, undefined, event);
				this.tree.setSelection(this.tree.getFocus(), event);
			}
		}
	}

	private getSearchTextFromEditor(allowUnselectedWord: boolean, editor?: IEditor): string | null {
		if (dom.isAncestorOfActiveElement(this.getContainer())) {
			return null;
		}

		editor = editor ?? this.editorService.activeTextEditorControl;

		if (!editor) {
			return null;
		}

		const allowUnselected = this.searchConfig.seedWithNearestWord && allowUnselectedWord;
		return getSelectionTextFromEditor(allowUnselected, editor);
	}

	toggleCaseSensitive(): void {
		this.searchWidget.searchInput?.setCaseSensitive(!this.searchWidget.searchInput.getCaseSensitive());
		this.triggerQueryChange({ shouldKeepAIResults: true });
	}

	toggleWholeWords(): void {
		this.searchWidget.searchInput?.setWholeWords(!this.searchWidget.searchInput.getWholeWords());
		this.triggerQueryChange({ shouldKeepAIResults: true });
	}

	toggleRegex(): void {
		this.searchWidget.searchInput?.setRegex(!this.searchWidget.searchInput.getRegex());
		this.triggerQueryChange({ shouldKeepAIResults: true });
	}

	togglePreserveCase(): void {
		this.searchWidget.replaceInput?.setPreserveCase(!this.searchWidget.replaceInput.getPreserveCase());
		this.triggerQueryChange({ shouldKeepAIResults: true });
	}

	setSearchParameters(args: IFindInFilesArgs = {}): void {
		if (typeof args.isCaseSensitive === 'boolean') {
			this.searchWidget.searchInput?.setCaseSensitive(args.isCaseSensitive);
		}
		if (typeof args.matchWholeWord === 'boolean') {
			this.searchWidget.searchInput?.setWholeWords(args.matchWholeWord);
		}
		if (typeof args.isRegex === 'boolean') {
			this.searchWidget.searchInput?.setRegex(args.isRegex);
		}
		if (typeof args.query === 'string') {
			this.searchWidget.searchInput?.setValue(args.query);
		}
		if (typeof args.replace === 'string') {
			this.searchWidget.replaceInput?.setValue(args.replace);
		} else {
			if (this.searchWidget.replaceInput && this.searchWidget.replaceInput.getValue() !== '') {
				this.searchWidget.replaceInput.setValue('');
			}
		}
		if (typeof args.triggerSearch === 'boolean' && args.triggerSearch) {
			this.triggerQueryChange();
		}
		if (typeof args.preserveCase === 'boolean') {
			this.searchWidget.replaceInput?.setPreserveCase(args.preserveCase);
		}
	}

	triggerQueryChange(_options?: { preserveFocus?: boolean; triggeredOnType?: boolean; delay?: number; shouldKeepAIResults?: boolean; shouldUpdateAISearch?: boolean }): void {
		const options = { preserveFocus: true, triggeredOnType: false, delay: 0, ..._options };

		if (options.triggeredOnType && !this.searchConfig.searchOnType) { return; }

		if (!this.pauseSearching) {

			const delay = options.triggeredOnType ? options.delay : 0;
			this.triggerQueryDelayer.trigger(() => {
				this._onQueryChanged(options.preserveFocus, options.triggeredOnType, options.shouldKeepAIResults, options.shouldUpdateAISearch);
			}, delay);
		}
	}

	private _onQueryChanged(preserveFocus: boolean, triggeredOnType = false, shouldKeepAIResults = false, shouldUpdateAISearch = false): void {
		if (!(this.searchWidget.searchInput?.inputBox.isInputValid())) {
			return;
		}

		const isRegex = this.searchWidget.searchInput.getRegex();
		const isWholeWords = this.searchWidget.searchInput.getWholeWords();
		const isCaseSensitive = this.searchWidget.searchInput.getCaseSensitive();
		const contentPattern = this.searchWidget.searchInput.getValue();

		if (contentPattern.length === 0) {
			this.clearSearchResults(false);
			this.clearMessage();
			this.clearAIResults();
			return;
		}

		const content: IPatternInfo = {
			pattern: contentPattern,
			isRegExp: isRegex,
			isCaseSensitive: isCaseSensitive,
			isWordMatch: isWholeWords,
		};

		// Need the full match line to correctly calculate replace text, if this is a search/replace with regex group references ($1, $2, ...).
		// 10000 chars is enough to avoid sending huge amounts of text around, if you do a replace with a longer match, it may or may not resolve the group refs correctly.
		// https://github.com/microsoft/vscode/issues/58374
		const charsPerLine = content.isRegExp ? 10000 : 1000;

		const options: ITextQueryBuilderOptions = {
			_reason: 'searchView',
			extraFileResources: this.instantiationService.invokeFunction(getOutOfWorkspaceEditorResources),
			maxResults: this.searchConfig.maxResults ?? undefined,
			ignoreGlobCase: !isLinux || undefined,
			// Vacha: no include/exclude UI — excludes and ignore files always apply
			excludePattern: [],
			includePattern: '',
			// Vacha: the search pane searches ONLY the active file
			onlyFileResources: this.getActiveFileResources(),
			previewOptions: {
				matchLines: 1,
				charsPerLine
			},
			isSmartCase: this.searchConfig.smartCase,
			expandPatterns: true
		};
		const folderResources = this.contextService.getWorkspace().folders;

		const onQueryValidationError = (err: Error) => {
			this.searchWidget.searchInput?.showMessage({ content: err.message, type: MessageType.ERROR });
			this.viewModel.searchResult.clear();
		};

		let query: ITextQuery;
		try {
			query = this.queryBuilder.text(content, folderResources.map(folder => folder.uri), options);
		} catch (err) {
			onQueryValidationError(err);
			return;
		}

		this.validateQuery(query).then(() => {
			if (!shouldKeepAIResults && shouldUpdateAISearch && this.tree.hasNode(this.searchResult.aiTextSearchResult)) {
				this.tree.collapse(this.searchResult.aiTextSearchResult);
			}

			this.onQueryTriggered(query, options, triggeredOnType, shouldKeepAIResults, shouldUpdateAISearch);

			if (!preserveFocus) {
				this.searchWidget.focus(false, undefined, true); // focus back to input field
			}
		}, onQueryValidationError);
	}

	private validateQuery(query: ITextQuery): Promise<void> {
		// Validate folderQueries
		const folderQueriesExistP =
			query.folderQueries.map(fq => {
				return this.fileService.exists(fq.folder).catch(() => false);
			});

		return Promise.all(folderQueriesExistP).then(existResults => {
			// If no folders exist, show an error message about the first one
			const existingFolderQueries = query.folderQueries.filter((folderQuery, i) => existResults[i]);
			if (!query.folderQueries.length || existingFolderQueries.length) {
				query.folderQueries = existingFolderQueries;
			} else {
				const nonExistantPath = query.folderQueries[0].folder.fsPath;
				const searchPathNotFoundError = nls.localize('searchPathNotFoundError', "Search path not found: {0}", nonExistantPath);
				return Promise.reject(new Error(searchPathNotFoundError));
			}

			return undefined;
		});
	}

	private onQueryTriggered(query: ITextQuery, options: ITextQueryBuilderOptions, triggeredOnType: boolean, shouldKeepAIResults: boolean, shouldUpdateAISearch: boolean): void {
		this.addToSearchHistoryDelayer.trigger(() => {
			this.searchWidget.searchInput?.onSearchSubmit();
		});

		this.viewModel.cancelSearch(true);
		if (!shouldKeepAIResults) {
			this.clearAIResults();
		}

		this.currentSearchQ = this.currentSearchQ
			.then(() => this.doSearch(query, triggeredOnType, shouldKeepAIResults, shouldUpdateAISearch))
			.then(() => undefined, () => undefined);
	}


	private async _updateResults() {
		if (this.state === SearchUIState.Idle) {
			return;
		}
		try {
			// Search result tree update
			const fileCount = this.viewModel.searchResult.fileCount();
			if (this._visibleMatches !== fileCount) {
				this._visibleMatches = fileCount;
				await this.refreshAndUpdateCount();
			}
		} finally {
			// show frequent progress and results by scheduling updates 80 ms after the last one
			this._refreshResultsScheduler.schedule();
		}
	}

	private appendSearchWithAIButton(messageEl: HTMLElement) {
		const searchWithAIButtonTooltip = this.keybindingService.appendKeybinding(
			nls.localize('triggerAISearch.tooltip', "Search with AI."),
			Constants.SearchCommandIds.SearchWithAIActionId
		);
		const searchWithAIButtonText = nls.localize('searchWithAIButtonTooltip', "Search with AI");
		const searchWithAIButton = this.messageDisposables.add(new SearchLinkButton(
			searchWithAIButtonText,
			() => {
				this.commandService.executeCommand(Constants.SearchCommandIds.SearchWithAIActionId);
			}, this.hoverService, searchWithAIButtonTooltip));
		dom.append(messageEl, searchWithAIButton.element);
	}

	private async onSearchComplete(
		progressComplete: () => void,
		completed?: ISearchComplete,
		shouldDoFinalRefresh = true,
		keywords?: AISearchKeyword[],
	) {

		this.state = SearchUIState.Idle;

		// Complete up to 100% as needed
		progressComplete();

		if (shouldDoFinalRefresh) {
			// anything that gets called from `getChildren` should not do this, since the tree will refresh anyways.
			await this.refreshAndUpdateCount();
		}

		const allResults = !this.viewModel.searchResult.isEmpty();
		const aiResults = this.searchResult.getCachedSearchComplete(true);
		if (completed?.exit === SearchCompletionExitCode.NewSearchStarted) {
			return;
		}

		// Special case for when we have an AI provider registered
		Constants.SearchContext.AIResultsRequested.bindTo(this.contextKeyService).set(this.shouldShowAIResults() && !!aiResults);

		// Expand AI results if the node is collapsed
		if (completed && this.tree.hasNode(this.searchResult.aiTextSearchResult) && this.tree.isCollapsed(this.searchResult.aiTextSearchResult)) {
			this.tree.expand(this.searchResult.aiTextSearchResult);
			return;
		}


		if (!allResults) {
			// Vacha: no include/exclude UI — only the plain message variants remain
			const message = !completed
				? SEARCH_CANCELLED_MESSAGE
				: nls.localize('noResultsFound', "No results found. Review your configured exclusions and check your gitignore files - ");

			// Indicate as status to ARIA
			aria.status(message);

			const messageEl = this.clearMessage();
			dom.append(messageEl, message);

			if (this.shouldShowAIResults()) {
				this.appendSearchWithAIButton(messageEl);
				dom.append(messageEl, $('span', undefined, ' - '));
			}

			if (!completed) {
				const searchAgainButton = this.messageDisposables.add(new SearchLinkButton(
					nls.localize('rerunSearch.message', "Search again"),
					() => this.triggerQueryChange({ preserveFocus: false }), this.hoverService));
				dom.append(messageEl, searchAgainButton.element);
			} else {
				const openSettingsButton = this.messageDisposables.add(new SearchLinkButton(nls.localize('openSettings.message', "Open Settings"), this.onOpenSettings.bind(this), this.hoverService));
				dom.append(messageEl, openSettingsButton.element);
			}

			this.reLayout();
		} else {
			this.viewModel.searchResult.toggleHighlights(this.isVisible()); // show highlights

			// Indicate final search result count for ARIA
			aria.status(nls.localize('ariaSearchResultsStatus', "Search returned {0} results in {1} files", this.viewModel.searchResult.count(), this.viewModel.searchResult.fileCount()));
		}


		if (completed && completed.limitHit) {
			completed.messages.push({ type: TextSearchCompleteMessageType.Warning, text: nls.localize('searchMaxResultsWarning', "The result set only contains a subset of all matches. Be more specific in your search to narrow down the results.") });
		}

		if (completed && completed.messages) {
			for (const message of completed.messages) {
				this.addMessage(message);
			}
		}

		this.reLayout();
		this.expandForResults();
	}

	private async onSearchError(e: any, progressComplete: () => void, completed?: ISearchComplete, shouldDoFinalRefresh = true) {
		this.state = SearchUIState.Idle;
		if (errors.isCancellationError(e)) {
			return this.onSearchComplete(progressComplete, completed, shouldDoFinalRefresh);
		} else {
			progressComplete();
			this.searchWidget.searchInput?.showMessage({ content: e.message, type: MessageType.ERROR });
			this.viewModel.searchResult.clear();

			return Promise.resolve();
		}
	}

	public clearAIResults() {
		this.model.searchResult.aiTextSearchResult.hidden = true;
		this.refreshTreeController.clearAllPending();
		this._pendingSemanticSearchPromise = undefined;
		this._cachedResults = undefined;
		this._cachedKeywords = [];
		this.model.cancelAISearch(true);
		this.model.clearAiSearchResults();
	}

	public async requestAIResults() {
		this.logService.info(`SearchView: Requesting semantic results from keybinding. Cached: ${!!this.cachedResults}`);
		if ((!this.cachedResults || this.cachedResults.results.length === 0) && !this._pendingSemanticSearchPromise) {
			this.clearAIResults();
		}
		this.model.searchResult.aiTextSearchResult.hidden = false;
		await this.queueRefreshTree();
		await forcedExpandRecursively(this.getControl(), this.model.searchResult.aiTextSearchResult);
	}

	public async addAIResults() {
		this.searchWidget.searchInput?.clearMessage();
		this.showEmptyStage();
		this._visibleMatches = 0;
		this.tree.setSelection([]);
		this.tree.setFocus([]);

		this.viewModel.replaceString = this.searchWidget.getReplaceValue();
		// Reuse pending aiSearch if available
		let aiSearchPromise = this._pendingSemanticSearchPromise;
		if (!aiSearchPromise) {
			this.viewModel.searchResult.setAIQueryUsingTextQuery();
			aiSearchPromise = this._pendingSemanticSearchPromise = this.viewModel.aiSearch(() => {
				// Clear pending promise when first result comes in
				if (this._pendingSemanticSearchPromise === aiSearchPromise) {
					this._pendingSemanticSearchPromise = undefined;
				}
			});
		}

		aiSearchPromise.then((complete) => {
			this.updateSearchResultCount(false);
			return this.onSearchComplete(() => { }, complete, false, complete.aiKeywords);
		}, (e) => {
			return this.onSearchError(e, () => { }, undefined, false);
		});
	}

	private doSearch(query: ITextQuery, triggeredOnType: boolean, shouldKeepAIResults: boolean, shouldUpdateAISearch: boolean): Thenable<void> {
		let progressComplete: () => void;
		this.progressService.withProgress({ location: this.getProgressLocation(), delay: triggeredOnType ? 300 : 0 }, _progress => {
			return new Promise<void>(resolve => progressComplete = resolve);
		});

		this.searchWidget.searchInput?.clearMessage();
		this.state = SearchUIState.Searching;
		this.showEmptyStage();
		if (this.model.searchResult.aiTextSearchResult.hidden && shouldUpdateAISearch) {
			this.logService.info(`SearchView: Semantic search visible. Keep semantic results: ${shouldKeepAIResults}. Update semantic search: ${shouldUpdateAISearch}`);
			this.model.searchResult.aiTextSearchResult.hidden = false;
		}

		const slowTimer = setTimeout(() => {
			this.state = SearchUIState.SlowSearch;
		}, 2000);

		this._visibleMatches = 0;

		this._refreshResultsScheduler.schedule();

		this.searchWidget.setReplaceAllActionState(false);

		this.tree.setSelection([]);
		this.tree.setFocus([]);

		this.viewModel.replaceString = this.searchWidget.getReplaceValue();
		const result = this.viewModel.search(query);

		if (!shouldKeepAIResults || shouldUpdateAISearch) {
			this.viewModel.searchResult.setAIQueryUsingTextQuery(query);
		}

		return result.asyncResults.then((complete) => {
			clearTimeout(slowTimer);
			return this.onSearchComplete(progressComplete, complete);
		}, (e) => {
			clearTimeout(slowTimer);
			return this.onSearchError(e, progressComplete);
		});
	}

	private onOpenSettings(e: dom.EventLike): void {
		dom.EventHelper.stop(e, false);
		// Vacha: only files.exclude survives - the search.* ignore-file settings are gone.
		this.openSettings('@id:files.exclude');
	}

	private openSettings(query: string): Promise<IEditorPane | undefined> {
		const options: ISettingsEditorOptions = { query };
		// Vacha: editor-only — there is never a workspace, so always user settings
		return this.preferencesService.openUserSettings(options);
	}

	private updateSearchResultCount(clear: boolean = false): void {
		if (this._cachedKeywords.length > 0) {
			return;
		}
		const fileCount = this.viewModel.searchResult.fileCount(this.viewModel.searchResult.aiTextSearchResult.hidden);
		const resultCount = this.viewModel.searchResult.count(this.viewModel.searchResult.aiTextSearchResult.hidden);
		this.hasSearchResultsKey.set(fileCount > 0);

		const msgWasHidden = this.messagesElement.style.display === 'none';

		const messageEl = this.clearMessage();
		const resultMsg = clear ? '' : this.buildResultCountMessage(resultCount, fileCount);
		this.tree.ariaLabel = resultMsg + nls.localize('forTerm', " - Search: {0}", this.searchResult.query?.contentPattern.pattern ?? '');
		dom.append(messageEl, resultMsg);

		if (fileCount > 0) {
			if (this.shouldShowAIResults()) {
				dom.append(messageEl, ' - ');
				this.appendSearchWithAIButton(messageEl);
			}

			this.reLayout();
		} else if (!msgWasHidden) {
			dom.hide(this.messagesElement);
		}
	}

	private addMessage(message: TextSearchCompleteMessage) {
		const messageBox = this.messagesElement.firstChild as HTMLDivElement;
		if (!messageBox) { return; }
		dom.append(messageBox, renderSearchMessage(message, this.instantiationService, this.notificationService, this.openerService, this.commandService, this.messageDisposables, () => this.triggerQueryChange()));
	}

	private buildResultCountMessage(resultCount: number, fileCount: number): string {
		if (resultCount === 1 && fileCount === 1) {
			return nls.localize('search.file.result', "{0} result in {1} file", resultCount, fileCount);
		} else if (resultCount === 1) {
			return nls.localize('search.files.result', "{0} result in {1} files", resultCount, fileCount);
		} else if (fileCount === 1) {
			return nls.localize('search.file.results', "{0} results in {1} file", resultCount, fileCount);
		} else {
			return nls.localize('search.files.results', "{0} results in {1} files", resultCount, fileCount);
		}
	}

	private showEmptyStage(forceHideMessages = false): void {
		const showingCancelled = (this.messagesElement.firstChild?.textContent?.indexOf(SEARCH_CANCELLED_MESSAGE) ?? -1) > -1;

		// clean up ui
		// this.replaceService.disposeAllReplacePreviews();
		if (showingCancelled || forceHideMessages || !this.configurationService.getValue<ISearchConfiguration>().search?.searchOnType) {
			// when in search to type, don't preemptively hide, as it causes flickering and shifting of the live results
			dom.hide(this.messagesElement);
		}

		dom.show(this.resultsElement);
		this.currentSelectedFileMatch = undefined;
	}

	private onFocus(lineMatch: ISearchTreeMatch, preserveFocus?: boolean, sideBySide?: boolean, pinned?: boolean): Promise<any> {
		const useReplacePreview = this.configurationService.getValue<ISearchConfiguration>().search?.useReplacePreview;

		const resource = isSearchTreeMatch(lineMatch) ? lineMatch.parent().resource : (<ISearchTreeFileMatch>lineMatch).resource;
		return (useReplacePreview && this.viewModel.isReplaceActive() && !!this.viewModel.replaceString) ?
			this.replaceService.openReplacePreview(lineMatch, preserveFocus, sideBySide, pinned) :
			this.open(lineMatch, preserveFocus, sideBySide, pinned, resource);
	}

	async open(element: FileMatchOrMatch, preserveFocus?: boolean, sideBySide?: boolean, pinned?: boolean, resourceInput?: URI): Promise<void> {
		const selection = getEditorSelectionFromMatch(element, this.viewModel);
		const resource = resourceInput ?? (isSearchTreeMatch(element) ? element.parent().resource : (<ISearchTreeFileMatch>element).resource);
		let editor: IEditorPane | undefined;

		const options = {
			preserveFocus,
			pinned,
			selection,
			revealIfVisible: true,
		};

		try {
			editor = await this.editorService.openEditor({
				resource: resource,
				options,
			}, sideBySide ? SIDE_GROUP : ACTIVE_GROUP);

			const editorControl = editor?.getControl();
			if (isSearchTreeMatch(element) && preserveFocus && isCodeEditor(editorControl)) {
				this.viewModel.searchResult.getRangeHighlightDecorations().highlightRange(
					editorControl.getModel()!,
					element.range()
				);
			} else {
				this.viewModel.searchResult.getRangeHighlightDecorations().removeHighlightRange();
			}
		} catch (err) {
			errors.onUnexpectedError(err);
			return;
		}
	}

	openEditorWithMultiCursor(element: FileMatchOrMatch): Promise<void> {
		const resource = isSearchTreeMatch(element) ? element.parent().resource : (<ISearchTreeFileMatch>element).resource;
		return this.editorService.openEditor({
			resource: resource,
			options: {
				preserveFocus: false,
				pinned: true,
				revealIfVisible: true
			}
		}).then(editor => {
			if (editor) {
				let fileMatch = null;
				if (isSearchTreeFileMatch(element)) {
					fileMatch = element;
				}
				else if (isSearchTreeMatch(element)) {
					fileMatch = element.parent();
				}

				if (fileMatch) {
					const selections = fileMatch.matches().map(m => new Selection(m.range().startLineNumber, m.range().startColumn, m.range().endLineNumber, m.range().endColumn));
					const codeEditor = getCodeEditor(editor.getControl());
					if (codeEditor) {
						const multiCursorController = MultiCursorSelectionController.get(codeEditor);
						multiCursorController?.selectAllUsingSelections(selections);
					}
				}
			}
			this.viewModel.searchResult.getRangeHighlightDecorations().removeHighlightRange();
		}, errors.onUnexpectedError);
	}

	private onUntitledDidDispose(resource: URI): void {
		if (!this.viewModel) {
			return;
		}

		// remove search results from this resource as it got disposed
		let matches = this.viewModel.searchResult.matches();
		for (let i = 0, len = matches.length; i < len; i++) {
			if (resource.toString() === matches[i].resource.toString()) {
				this.viewModel.searchResult.remove(matches[i]);
			}
		}
		matches = this.viewModel.searchResult.matches(true);
		for (let i = 0, len = matches.length; i < len; i++) {
			if (resource.toString() === matches[i].resource.toString()) {
				this.viewModel.searchResult.remove(matches[i]);
			}
		}

		// Vacha: the untitled file is gone for good — its cached search state too
		this.deleteSearchStateForFile(resource.toString());
	}

	private onFilesChanged(e: FileChangesEvent): void {
		if (!this.viewModel || (this.searchConfig.sortOrder !== SearchSortOrder.Modified && !e.gotDeleted())) {
			return;
		}

		const matches = this.viewModel.searchResult.matches();
		if (e.gotDeleted()) {
			const deletedMatches = matches.filter(m => e.contains(m.resource, FileChangeType.DELETED));

			this.viewModel.searchResult.remove(deletedMatches);

			// Vacha: drop cached per-file search state of deleted files
			for (const key of [...this.perFileSearchState.keys()]) {
				if (e.contains(URI.parse(key), FileChangeType.DELETED)) {
					this.deleteSearchStateForFile(key);
				}
			}
		} else {
			// Check if the changed file contained matches
			const changedMatches = matches.filter(m => e.contains(m.resource));
			if (changedMatches.length && this.searchConfig.sortOrder === SearchSortOrder.Modified) {
				// No matches need to be removed, but modified files need to have their file stat updated.
				this.updateFileStats(changedMatches).then(async () => this.refreshTreeController.queue());
			}
		}
	}

	// Vacha: the search scope — the active editor's file (empty list when the
	// active editor has no file resource, which yields zero results rather
	// than silently searching everything).
	private getActiveFileResources(): URI[] {
		const active = this.editorService.activeEditor?.resource;
		return active ? [active] : [];
	}

	//#region Vacha: per-file search pane state

	/**
	 * Swaps the whole pane content when the active editor changes file: the
	 * outgoing file's widget state and result model are saved, the incoming
	 * file's are restored (or a fresh empty state, which the auto-height then
	 * collapses to just the input row).
	 */
	private onActiveEditorChangedForSearchState(): void {
		if (this.isDisposed || !this.searchWidget || !this.tree) {
			return;
		}

		const newKey = this.editorService.activeEditor?.resource?.toString();
		if (newKey === this.currentStateKey) {
			return; // e.g. group focus changes re-fire for the same resource
		}

		// cancel in-flight searches on the outgoing model and take its
		// highlights out of the (no longer active) editor
		const outgoingModel = this.viewModel;
		outgoingModel.cancelSearch(true);
		outgoingModel.cancelAISearch(true);
		outgoingModel.searchResult.toggleHighlights(false);

		const outgoingModelRetained = this.currentStateKey !== undefined
			&& this.saveSearchStateForFile(this.currentStateKey, outgoingModel);

		this.currentStateKey = newKey;
		const entry = newKey !== undefined ? this.perFileSearchState.get(newKey) : undefined;
		if (newKey !== undefined && entry) {
			// refresh LRU recency
			this.perFileSearchState.delete(newKey);
			this.perFileSearchState.set(newKey, entry);
		}
		this.applySearchStateForActiveFile(entry);

		if (!outgoingModelRetained) {
			// the swap detached the model and no cache entry kept it
			outgoingModel.dispose();
		}
	}

	/**
	 * Snapshots the widgets (and the model, when it has results) for `key`.
	 * Returns whether the model was retained by the cache entry.
	 */
	private saveSearchStateForFile(key: string, model: ISearchModel): boolean {
		const searchInput = this.searchWidget.searchInput;
		const hasResults = !model.searchResult.isEmpty();
		const state: IPerFileSearchState = {
			query: searchInput?.getValue() ?? '',
			replaceText: this.searchWidget.getReplaceValue(),
			isRegex: searchInput?.getRegex() ?? false,
			isCaseSensitive: searchInput?.getCaseSensitive() ?? false,
			isWholeWords: searchInput?.getWholeWords() ?? false,
			preserveCase: this.searchWidget.replaceInput?.getPreserveCase() ?? false,
			replaceShown: this.searchWidget.isReplaceShown(),
			model: hasResults ? model : undefined,
		};

		this.perFileSearchState.delete(key);
		if (!hasResults && state.query === '' && state.replaceText === '' &&
			!state.isRegex && !state.isCaseSensitive && !state.isWholeWords && !state.preserveCase) {
			return false; // the pane was empty for this file — nothing worth keeping
		}
		this.perFileSearchState.set(key, state);
		this.trimPerFileSearchState();
		return hasResults;
	}

	/** LRU cap: evicts the oldest entries, disposing their retained models. */
	private trimPerFileSearchState(): void {
		while (this.perFileSearchState.size > SearchView.MAX_PER_FILE_SEARCH_STATES) {
			const oldest = this.perFileSearchState.entries().next().value;
			if (!oldest) {
				break;
			}
			const [key, entry] = oldest;
			this.perFileSearchState.delete(key);
			if (entry.model && entry.model !== this.viewModel) {
				entry.model.dispose();
			}
		}
	}

	/** Restores `entry`'s widget state and model, or a fresh empty state. */
	private applySearchStateForActiveFile(entry: IPerFileSearchState | undefined): void {
		// restore the widgets without retriggering search-on-type,
		// exactly like updateText() does
		this.pauseSearching = true;
		try {
			const searchInput = this.searchWidget.searchInput;
			searchInput?.setValue(entry?.query ?? '');
			searchInput?.setRegex(entry?.isRegex ?? false);
			searchInput?.setCaseSensitive(entry?.isCaseSensitive ?? false);
			searchInput?.setWholeWords(entry?.isWholeWords ?? false);
			this.searchWidget.replaceInput?.setValue(entry?.replaceText ?? '');
			this.searchWidget.replaceInput?.setPreserveCase(entry?.preserveCase ?? false);
			if (entry) {
				// a fresh state keeps the replace row as the user last left it
				this.searchWidget.toggleReplace(entry.replaceShown);
			}
		} finally {
			this.pauseSearching = false;
		}

		const model = entry?.model ?? this.instantiationService.createInstance(SearchModelImpl);
		if (entry) {
			entry.model = model;
		}
		this.attachSearchModel(model);
	}

	/**
	 * The replaceSearchModel recipe minus the dispose: cached per-file models
	 * must survive the swap, so the service's `searchModel` setter (which
	 * disposes the previous model) cannot be used here.
	 */
	private attachSearchModel(model: ISearchModel): void {
		model.location = SearchModelLocation.PANEL;
		model.replaceActive = this.searchWidget.isReplaceActive();
		model.replaceString = this.searchWidget.getReplaceValue();
		model.preserveCase = this.searchWidget.replaceInput?.getPreserveCase() ?? false;

		this._onSearchResultChangedDisposable?.dispose();
		this._onSearchResultChangedDisposable = this._register(model.onSearchResultChanged(async (event) => await this.onSearchResultsChanged(event)));

		this._onAIResultChangedDisposable?.dispose();
		this._onAIResultChangedDisposable = this._register(model.searchResult.aiTextSearchResult.onChange((e) => {
			// Only refresh the AI node, not the whole tree
			if (this.tree && this.tree.hasNode(this.searchResult.aiTextSearchResult) && !e.removed) {
				this.tree.updateChildren(this.searchResult.aiTextSearchResult);
			}
		}));

		// A throttled refresh queued against the outgoing model must not land on
		// the new input — the async data tree throws "node not found" for it.
		this.refreshTreeController.reset();

		this.searchViewModelWorkbenchService.swapSearchModel(model);
		this.viewModel = model;
		this.tree.setInput(this.viewModel.searchResult);
		this.viewModel.searchResult.toggleHighlights(this.isVisible());
		this.refreshAndUpdateCount().then(() => this.expandForResults(), errors.onUnexpectedError);
		this.reLayout();
	}

	/** Discards a file's cached state, disposing its model unless attached. */
	private deleteSearchStateForFile(key: string): void {
		const entry = this.perFileSearchState.get(key);
		if (!entry) {
			return;
		}
		this.perFileSearchState.delete(key);
		if (entry.model && entry.model !== this.viewModel) {
			entry.model.dispose();
		}
	}

	//#endregion

	private get searchConfig(): ISearchConfigurationProperties {
		return this.configurationService.getValue<ISearchConfigurationProperties>('search');
	}

	private clearHistory(): void {
		this.searchWidget.clearHistory();
	}

	public override saveState(): void {
		// This can be called before renderBody() method gets called for the first time
		// if we move the searchView inside another viewPaneContainer
		if (!this.searchWidget) {
			return;
		}

		// Vacha: the query itself (pattern, replace text, toggles) is per-file
		// and in-memory only — deliberately NOT persisted across restarts.
		// Only genuinely view-level bits are saved.
		if (!this.viewletState.view) {
			this.viewletState.view = {};
		}

		this.viewletState.view.showReplace = this.searchAndReplaceWidget.isReplaceShown();
		this.viewletState.view.treeLayout = this.isTreeLayoutViewVisible;

		this._saveSearchHistoryService();

		this.memento.saveMemento();

		super.saveState();
	}

	private _saveSearchHistoryService() {
		if (this.searchWidget === undefined) {
			return;
		}
		const history: ISearchHistoryValues = Object.create(null);

		const searchHistory = this.searchWidget.getSearchHistory();
		if (searchHistory && searchHistory.length) {
			history.search = searchHistory;
		}

		const replaceHistory = this.searchWidget.getReplaceHistory();
		if (replaceHistory && replaceHistory.length) {
			history.replace = replaceHistory;
		}

		this.searchHistoryService.save(history);
	}


	private async updateFileStats(elements: ISearchTreeFileMatch[]): Promise<void> {
		const files = elements.map(f => f.resolveFileStat(this.fileService));
		await Promise.all(files);
	}

	private removeFileStats(): void {
		for (const fileMatch of this.searchResult.matches()) {
			fileMatch.fileStat = undefined;
		}
		for (const fileMatch of this.searchResult.matches(true)) {
			fileMatch.fileStat = undefined;
		}
	}

	override dispose(): void {
		this.isDisposed = true;
		this.saveState();
		// Vacha: release every cached per-file search model (the attached one
		// stays with the view-model service)
		for (const entry of this.perFileSearchState.values()) {
			if (entry.model && entry.model !== this.viewModel) {
				entry.model.dispose();
			}
		}
		this.perFileSearchState.clear();
		super.dispose();
	}
}


class SearchLinkButton extends Disposable {
	public readonly element: HTMLElement;

	constructor(label: string, handler: (e: dom.EventLike) => unknown, hoverService: IHoverService, tooltip?: string) {
		super();
		this.element = $('a.pointer', { tabindex: 0 }, label);
		this._register(hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), this.element, tooltip));
		this.addEventHandlers(handler);
	}

	private addEventHandlers(handler: (e: dom.EventLike) => unknown): void {
		const wrappedHandler = (e: dom.EventLike) => {
			dom.EventHelper.stop(e, false);
			handler(e);
		};

		this._register(dom.addDisposableListener(this.element, dom.EventType.CLICK, wrappedHandler));
		this._register(dom.addDisposableListener(this.element, dom.EventType.KEY_DOWN, e => {
			const event = new StandardKeyboardEvent(e);
			if (event.equals(KeyCode.Space) || event.equals(KeyCode.Enter)) {
				wrappedHandler(e);
				event.preventDefault();
				event.stopPropagation();
			}
		}));
	}
}

export function getEditorSelectionFromMatch(element: FileMatchOrMatch, viewModel: ISearchModel) {
	let match: ISearchTreeMatch | null = null;
	if (isSearchTreeMatch(element)) {
		match = element;
	}
	if (isSearchTreeFileMatch(element) && element.count() > 0) {
		match = element.matches()[element.matches().length - 1];
	}
	if (match) {
		const range = match.range();
		if (viewModel.isReplaceActive() && !!viewModel.replaceString) {
			const replaceString = match.replaceString;
			return {
				startLineNumber: range.startLineNumber,
				startColumn: range.startColumn,
				endLineNumber: range.startLineNumber,
				endColumn: range.startColumn + replaceString.length
			};
		}
		return range;
	}
	return undefined;
}

export function getSelectionTextFromEditor(allowUnselectedWord: boolean, activeEditor: IEditor): string | null {

	let editor = activeEditor;

	if (isDiffEditor(editor)) {
		if (editor.getOriginalEditor().hasTextFocus()) {
			editor = editor.getOriginalEditor();
		} else {
			editor = editor.getModifiedEditor();
		}
	}

	if (!isCodeEditor(editor) || !editor.hasModel()) {
		return null;
	}

	const range = editor.getSelection();
	if (!range) {
		return null;
	}

	if (range.isEmpty()) {
		if (allowUnselectedWord) {
			const wordAtPosition = editor.getModel().getWordAtPosition(range.getStartPosition());
			return wordAtPosition?.word ?? null;
		} else {
			return null;
		}
	}

	let searchText = '';
	for (let i = range.startLineNumber; i <= range.endLineNumber; i++) {
		let lineText = editor.getModel().getLineContent(i);
		if (i === range.endLineNumber) {
			lineText = lineText.substring(0, range.endColumn - 1);
		}

		if (i === range.startLineNumber) {
			lineText = lineText.substring(range.startColumn - 1);
		}

		if (i !== range.startLineNumber) {
			lineText = '\n' + lineText;
		}

		searchText += lineText;
	}

	return searchText;
}

class SearchViewDataSource implements IAsyncDataSource<ISearchResult, RenderableMatch> {

	constructor(
		private searchView: SearchView,
		@IConfigurationService private configurationService: IConfigurationService,
	) { }


	private get searchConfig(): ISearchConfigurationProperties {
		return this.configurationService.getValue<ISearchConfigurationProperties>('search');
	}

	private createSearchResultIterator(searchResult: ISearchResult): Iterable<RenderableMatch> {

		const ret: ITextSearchHeading[] = [];

		if (this.searchView.shouldShowAIResults() && searchResult.searchModel.hasPlainResults && !searchResult.aiTextSearchResult.hidden) {
			// as long as there is a query present, we can load AI results
			ret.push(searchResult.aiTextSearchResult);
		}

		if (!searchResult.plainTextSearchResult.isEmpty()) {
			if (!this.searchView.shouldShowAIResults() || searchResult.aiTextSearchResult.hidden) {
				// only one root, so just return the children
				return this.createTextSearchResultIterator(searchResult.plainTextSearchResult);
			}
			ret.push(searchResult.plainTextSearchResult);

		}

		return ret;

	}

	private createTextSearchResultIterator(textSearchResult: ITextSearchHeading): Iterable<ISearchTreeFolderMatch | ISearchTreeFileMatch> {
		const folderMatches = textSearchResult.folderMatches()
			.filter(fm => !fm.isEmpty())
			.sort(searchMatchComparer);

		if (folderMatches.length === 1) {
			return this.createFolderIterator(folderMatches[0]);
		}
		return folderMatches;
	}

	private createFolderIterator(folderMatch: ISearchTreeFolderMatch): Iterable<ISearchTreeFolderMatch | ISearchTreeFileMatch> {
		const matchArray = this.searchView.isTreeLayoutViewVisible ? folderMatch.matches() : folderMatch.allDownstreamFileMatches();
		let matches = matchArray;
		if (!(folderMatch instanceof AIFolderMatchWorkspaceRootImpl)) {
			matches = matchArray.sort((a, b) => searchMatchComparer(a, b, this.searchConfig.sortOrder));
		}

		return matches;
	}

	private createFileIterator(fileMatch: ISearchTreeFileMatch): Iterable<ISearchTreeMatch> {
		const matches = fileMatch.matches().sort(searchMatchComparer);
		return matches;
	}

	hasChildren(element: RenderableMatch): boolean {
		if (isSearchTreeMatch(element)) {
			return false;
		}

		if (isTextSearchHeading(element) && element.isAIContributed) {
			return true;
		}

		const hasChildren = element.hasChildren;
		return hasChildren;
	}

	getChildren(element: RenderableMatch | ISearchResult): Iterable<RenderableMatch> | Promise<Iterable<RenderableMatch>> {
		if (isSearchResult(element)) {
			return this.createSearchResultIterator(element);
		} else if (isTextSearchHeading(element)) {
			if (element.isAIContributed && (!this.searchView.model.hasAIResults || !!this.searchView._pendingSemanticSearchPromise)) {
				if (this.searchView.cachedResults) {
					return this.createTextSearchResultIterator(element);
				}
				this.searchView.addAIResults();
				return new Promise<Iterable<RenderableMatch>>(resolve => {
					const disposable = element.onChange(() => {
						disposable.dispose(); // Clean up listener after first result
						resolve(this.createTextSearchResultIterator(element));
					});
				});
			}
			return this.createTextSearchResultIterator(element);
		} else if (isSearchTreeFolderMatch(element)) {
			return this.createFolderIterator(element);
		} else if (isSearchTreeFileMatch(element)) {
			return this.createFileIterator(element);
		}

		return [];

	}
	getParent(element: RenderableMatch): RenderableMatch {
		const parent = element.parent();
		if (isSearchResult(parent)) {
			throw new Error('Invalid element passed to getParent');
		}
		return parent;
	}
}

class RefreshTreeController extends Disposable {

	private refreshTreeThrottler: Throttler;

	constructor(
		private readonly searchView: SearchView,
		private readonly geSearchConfig: () => ISearchConfigurationProperties,
		@IFileService private readonly fileService: IFileService,
	) {
		super();
		this.refreshTreeThrottler = this._register(new Throttler());
	}

	private queuedIChangeEvents: IChangeEvent[] = [];

	public clearAllPending(): void {
		this.searchView.getControl().cancelAllRefreshPromises(true);
	}

	/**
	 * Vacha: drops queued change events and cancels in-flight refreshes. Called
	 * when the search model is swapped for another file's — events queued
	 * against the outgoing model reference nodes the new tree input does not
	 * have.
	 */
	public reset(): void {
		this.queuedIChangeEvents = [];
		this.clearAllPending();
	}

	public async queue(e?: IChangeEvent): Promise<void> {
		if (e) {
			this.queuedIChangeEvents.push(e);
		}
		return this.refreshTreeThrottler.queue(this.refreshTreeUsingQueue.bind(this));
	}

	private async refreshTreeUsingQueue(): Promise<void> {
		const aggregateChangeEvent: IChangeEvent | undefined = this.queuedIChangeEvents.length === 0 ? undefined : {
			elements: this.queuedIChangeEvents.map(e => e.elements).flat(),
			added: this.queuedIChangeEvents.some(e => e.added),
			removed: this.queuedIChangeEvents.some(e => e.removed),
			clearingAll: this.queuedIChangeEvents.some(e => e.clearingAll),
		};
		this.queuedIChangeEvents = [];
		return this.refreshTree(aggregateChangeEvent);
	}

	private async retrieveFileStats(): Promise<void> {
		const files = this.searchView.model.searchResult.matches().filter(f => !f.fileStat).map(f => f.resolveFileStat(this.fileService));
		await Promise.all(files);
	}

	private async refreshTree(event?: IChangeEvent): Promise<void> {
		// Vacha: the per-file model swap can replace the tree input while a
		// refresh is in flight; the async data tree then throws "node not
		// found" for elements of the superseded input. Detect the swap and
		// swallow only that case.
		const inputAtStart = this.searchView.model.searchResult;
		try {
			await this.doRefreshTree(event);
		} catch (error) {
			if (this.searchView.model.searchResult !== inputAtStart) {
				return; // the refresh lost against a model swap — the new input was rendered by its own refresh
			}
			throw error;
		}
	}

	private async doRefreshTree(event?: IChangeEvent): Promise<void> {
		const searchConfig = this.geSearchConfig();
		if (!event || event.added || event.removed) {
			// Refresh whole tree
			if (searchConfig.sortOrder === SearchSortOrder.Modified) {
				// Ensure all matches have retrieved their file stat
				await this.retrieveFileStats()
					.then(() => this.searchView.getControl().updateChildren(undefined));
			} else {
				await this.searchView.getControl().updateChildren(undefined);
			}
		} else {
			// If updated counts affect our search order, re-sort the view.
			if (searchConfig.sortOrder === SearchSortOrder.CountAscending ||
				searchConfig.sortOrder === SearchSortOrder.CountDescending) {

				await this.searchView.getControl().updateChildren(undefined);
			} else {
				const treeHasAllElements = event.elements.every(elem => this.searchView.getControl().hasNode(elem));
				if (treeHasAllElements) {
					// IFileMatchInstance modified, refresh those elements
					await Promise.all(event.elements.map(async element => {
						await this.searchView.getControl().updateChildren(element);
						this.searchView.getControl().rerender(element);
					}));
				} else {
					this.searchView.getControl().updateChildren(undefined);
				}
			}
		}
	}
}
