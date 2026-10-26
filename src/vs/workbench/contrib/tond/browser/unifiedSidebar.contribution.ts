/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { IViewContainerModel, IViewDescriptor, IViewDescriptorService, ViewContainer, ViewVisibilityState } from '../../../common/views.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { VIEWLET_ID as EXPLORER_VIEWLET_ID, VIEW_ID as EXPLORER_VIEW_ID } from '../../files/common/files.js';
import { OpenEditorsView } from '../../files/browser/views/openEditorsView.js';
import { VIEW_ID as SEARCH_VIEW_ID } from '../../../services/search/common/search.js';

/** Views that Tond gathers into the single Explorer sidebar pane, in order.
 * (Git/SCM removed — Search is the only relocated view.) */
const RELOCATED_VIEW_IDS = [SEARCH_VIEW_ID];

/** Context key the search view sets when it has results (see search constants). */
const HAS_SEARCH_RESULTS_KEY = 'hasSearchResult';

/**
 * Relative default heights for the expandable accordions. Collapsed panes
 * (Open Editors, Repositories) only render their header, so their weight is
 * effectively ignored; the file tree stays dominant (~2/3) with Changes at
 * roughly half of it, the Graph short (about two rows), and Search compact
 * until it has results (see the search view's own auto-height).
 */
const DEFAULT_SIZE_WEIGHTS: Record<string, number> = {
	[OpenEditorsView.ID]: 22,
	[SEARCH_VIEW_ID]: 90,
	[EXPLORER_VIEW_ID]: 640,
};

/**
 * Tond presents a single Explorer sidebar pane: the Search view and the three
 * Source Control views (Repositories, Changes, Graph) are moved out of their
 * own containers and into the Explorer container, so there is only one sidebar
 * tab (which the hidden activity bar then drops entirely). View order,
 * visibility, and collapsed state come from the view descriptors; this
 * contribution performs the relocation, seeds the default pane sizes once, and
 * restores those default proportions whenever a search is cleared.
 */
class UnifiedSidebarContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.tondUnifiedSidebar';

	private static readonly SIZING_APPLIED_KEY = 'tond.unifiedSidebarSizingApplied';

	private readonly reclaimScheduler = this._register(new MutableDisposable());
	private readonly relaxScheduler = this._register(new MutableDisposable());

	constructor(
		@IViewDescriptorService private readonly viewDescriptorService: IViewDescriptorService,
		@IStorageService private readonly storageService: IStorageService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IViewsService private readonly viewsService: IViewsService,
	) {
		super();

		const explorer = this.viewDescriptorService.getViewContainerById(EXPLORER_VIEWLET_ID);
		if (!explorer) {
			return;
		}

		this.relocateViews(explorer);
		this.seedDefaultSizesOnce(explorer);
		this.restoreDefaultsWhenSearchClears();
	}

	private relocateViews(explorer: ViewContainer): void {
		// group by current container: moveViewsToContainer derives the source
		// from the first view only, so views from different containers (Search
		// vs Source Control) must be moved in separate calls or they end up
		// added to Explorer without being removed from their origin
		const bySource = new Map<ViewContainer, IViewDescriptor[]>();
		for (const id of RELOCATED_VIEW_IDS) {
			const descriptor = this.viewDescriptorService.getViewDescriptorById(id);
			const current = this.viewDescriptorService.getViewContainerByViewId(id);
			if (!descriptor || !current || current === explorer) {
				continue;
			}
			const group = bySource.get(current) ?? [];
			group.push(descriptor);
			bySource.set(current, group);
		}
		for (const group of bySource.values()) {
			// keep each view's own default visibility (Search visible, the SCM
			// views gated by their `when`); descriptor order does the sorting
			this.viewDescriptorService.moveViewsToContainer(group, explorer, ViewVisibilityState.Default, UnifiedSidebarContribution.ID);
		}
	}

	private seedDefaultSizesOnce(explorer: ViewContainer): void {
		if (this.storageService.getBoolean(UnifiedSidebarContribution.SIZING_APPLIED_KEY, StorageScope.PROFILE, false)) {
			return;
		}
		this.storageService.store(UnifiedSidebarContribution.SIZING_APPLIED_KEY, true, StorageScope.PROFILE, StorageTarget.USER);
		this.applyDefaultSizes(explorer);
	}

	/**
	 * When the search results clear (reset, cleared input, or a search with no
	 * matches), the collapsing Search accordion frees height. The split view's
	 * proportional layout would otherwise scatter that height and inflate the
	 * short Graph pane, so make the file tree reclaim it instead.
	 */
	private restoreDefaultsWhenSearchClears(): void {
		const keys = new Set([HAS_SEARCH_RESULTS_KEY]);
		let hadResults = this.contextKeyService.getContextKeyValue<boolean>(HAS_SEARCH_RESULTS_KEY) ?? false;
		this._register(this.contextKeyService.onDidChangeContext(e => {
			if (!e.affectsSome(keys)) {
				return;
			}
			const hasResults = this.contextKeyService.getContextKeyValue<boolean>(HAS_SEARCH_RESULTS_KEY) ?? false;
			if (hadResults && !hasResults) {
				// run after the search view finishes its own collapse layout
				this.reclaimScheduler.value = dom.scheduleAtNextAnimationFrame(dom.getActiveWindow(), () => this.reclaimSpaceForFileTree());
			}
			hadResults = hasResults;
		}));
	}

	/**
	 * Momentarily raises the file tree pane's minimum height so the split view
	 * grows it to absorb the height a collapsing Search (or Graph) leaves, then
	 * relaxes the minimum so it stays freely resizable. Persisted pane sizes are
	 * not applied live (only on restore), so this size-floor nudge — the same
	 * mechanism the search view uses — is what actually re-lays-out the panes.
	 */
	private reclaimSpaceForFileTree(): void {
		const pane = this.viewsService.getViewWithId<ViewPane>(EXPLORER_VIEW_ID);
		if (!pane) {
			return;
		}
		const originalMinimum = pane.minimumBodySize;
		pane.minimumBodySize = 1e6;
		this.relaxScheduler.value = dom.scheduleAtNextAnimationFrame(dom.getActiveWindow(), () => {
			pane.minimumBodySize = originalMinimum;
		});
	}

	private applyDefaultSizes(explorer: ViewContainer): void {
		const model: IViewContainerModel = this.viewDescriptorService.getViewContainerModel(explorer);
		const present = new Set(model.allViewDescriptors.map(v => v.id));
		const sizes = Object.entries(DEFAULT_SIZE_WEIGHTS)
			.filter(([id]) => present.has(id))
			.map(([id, size]) => ({ id, size }));
		if (sizes.length) {
			model.setSizes(sizes);
		}
	}
}

registerWorkbenchContribution2(UnifiedSidebarContribution.ID, UnifiedSidebarContribution, WorkbenchPhase.AfterRestored);
