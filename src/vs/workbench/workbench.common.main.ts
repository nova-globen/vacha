/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//#region --- editor/workbench core

import '../editor/editor.all.js';

import './browser/workbench.contribution.js';
import './browser/workbench.zenMode.contribution.js';

//#endregion


//#region --- workbench actions

import './browser/actions/textInputActions.js';
import './browser/actions/developerActions.js';
import './browser/actions/helpActions.js';
import './browser/actions/layoutActions.js';
import './browser/actions/listCommands.js';
import './browser/actions/navigationActions.js';
import './browser/actions/windowActions.js';
import './browser/actions/workspaceActions.js';
import './browser/actions/workspaceCommands.js';
import './browser/actions/quickAccessActions.js';
import './browser/actions/widgetNavigationCommands.js';

//#endregion


//#region --- API Extension Points

import './services/actions/common/menusExtensionPoint.js';
import './services/extensions/common/configurationExtensionPoint.js';

//#endregion


//#region --- workbench parts

import './browser/parts/editor/editor.contribution.js';
import './browser/parts/editor/editorParts.js';
import './browser/parts/paneCompositePartService.js';
import './browser/parts/banner/bannerPart.js';
import './browser/parts/statusbar/statusbarPart.js';
import './browser/parts/titlebar/menubar.contribution.js';

//#endregion


//#region --- workbench services

import '../platform/actions/common/actions.contribution.js';
import '../platform/undoRedo/common/undoRedoService.js';
import './services/workspaces/common/editSessionIdentityService.js';
import './services/workspaces/common/canonicalUriService.js';
import './services/extensions/browser/extensionUrlHandler.js';
import './services/keybinding/common/keybindingEditing.js';
import './services/decorations/browser/decorationsService.js';
import './services/dialogs/common/dialogService.js';
import './services/progress/browser/progressService.js';
import './services/editor/browser/codeEditorService.js';
import './services/preferences/browser/preferencesService.js';
import './services/configuration/common/jsonEditingService.js';
import './services/textmodelResolver/common/textModelResolverService.js';
import './services/editor/browser/editorService.js';
import './services/editor/browser/editorResolverService.js';
import './services/history/browser/historyService.js';
import './services/activity/browser/activityService.js';
import './services/keybinding/browser/keybindingService.js';
import './services/untitled/common/untitledTextEditorService.js';
import './services/textresourceProperties/common/textResourcePropertiesService.js';
import './services/textfile/common/textEditorService.js';
import './services/language/common/languageService.js';
import './services/model/common/modelService.js';
import './services/notebook/common/notebookDocumentService.js';
import './services/commands/common/commandService.js';
import './services/themes/browser/workbenchThemeService.js';
import './services/label/common/labelService.js';
import './services/extensions/common/extensionManifestPropertiesService.js';
import './services/extensionManagement/common/extensionGalleryService.js';
import './services/extensionManagement/browser/extensionEnablementService.js';
import './services/extensionManagement/browser/builtinExtensionsScannerService.js';
import './services/extensionRecommendations/common/extensionIgnoredRecommendationsService.js';
import './services/extensionRecommendations/common/workspaceExtensionsConfig.js';
import './services/extensionManagement/common/extensionFeaturesManagemetService.js';
import './services/notification/common/notificationService.js';
import './services/userDataSync/common/userDataSyncUtil.js';
import './services/userDataProfile/browser/userDataProfileImportExportService.js';
import './services/userDataProfile/browser/userDataProfileManagement.js';
import './services/userDataProfile/common/remoteUserDataProfiles.js';
import './services/remote/common/remoteExplorerService.js';
import './services/remote/common/remoteExtensionsScanner.js';
import './services/workingCopy/common/workingCopyService.js';
import './services/workingCopy/common/workingCopyFileService.js';
import './services/workingCopy/common/workingCopyEditorService.js';
import './services/filesConfiguration/common/filesConfigurationService.js';
import './services/views/browser/viewDescriptorService.js';
import './services/views/browser/viewsService.js';
import './services/quickinput/browser/quickInputService.js';
import './services/userDataSync/browser/userDataSyncWorkbenchService.js';
import './services/authentication/browser/authenticationService.js';
import './services/authentication/browser/authenticationExtensionsService.js';
import './services/authentication/browser/authenticationUsageService.js';
import './services/authentication/browser/authenticationAccessService.js';
import './services/authentication/browser/dynamicAuthenticationProviderStorageService.js';
import './services/authentication/browser/authenticationQueryService.js';
import '../platform/hover/browser/hoverService.js';
import '../platform/userInteraction/browser/userInteractionServiceImpl.js';
import './services/assignment/common/assignmentService.js';
import './services/outline/browser/outlineService.js';
import './services/languageDetection/browser/languageDetectionWorkerServiceImpl.js';
import '../editor/common/services/languageFeaturesService.js';
import '../editor/common/services/semanticTokensStylingService.js';
import '../editor/common/services/treeViewsDndService.js';
import './services/textMate/browser/textMateTokenizationFeature.contribution.js';
import './services/treeSitter/browser/treeSitter.contribution.js';
import './services/userActivity/common/userActivityService.js';
import './services/userActivity/browser/userActivityBrowser.js';
import './services/userAttention/browser/userAttentionBrowser.js';
import './services/editor/browser/editorPaneService.js';
import './services/editor/common/customEditorLabelService.js';
import './services/log/common/defaultLogLevels.js';

import { InstantiationType, registerSingleton } from '../platform/instantiation/common/extensions.js';
import { GlobalExtensionEnablementService } from '../platform/extensionManagement/common/extensionEnablementService.js';
import { IAllowedExtensionsService, IGlobalExtensionEnablementService } from '../platform/extensionManagement/common/extensionManagement.js';
import { ContextViewService } from '../platform/contextview/browser/contextViewService.js';
import { IContextViewService } from '../platform/contextview/browser/contextView.js';
import { IListService, ListService } from '../platform/list/browser/listService.js';
import { MarkerDecorationsService } from '../editor/common/services/markerDecorationsService.js';
import { IMarkerDecorationsService } from '../editor/common/services/markerDecorations.js';
import { IMarkerService } from '../platform/markers/common/markers.js';
import { MarkerService } from '../platform/markers/common/markerService.js';
import { ContextKeyService } from '../platform/contextkey/browser/contextKeyService.js';
import { IContextKeyService } from '../platform/contextkey/common/contextkey.js';
import { ITextResourceConfigurationService } from '../editor/common/services/textResourceConfiguration.js';
import { TextResourceConfigurationService } from '../editor/common/services/textResourceConfigurationService.js';
import { IDownloadService } from '../platform/download/common/download.js';
import { DownloadService } from '../platform/download/common/downloadService.js';
import { OpenerService } from '../editor/browser/services/openerService.js';
import { IOpenerService } from '../platform/opener/common/opener.js';
import { IgnoredExtensionsManagementService, IIgnoredExtensionsManagementService } from '../platform/userDataSync/common/ignoredExtensions.js';
import { ExtensionStorageService, IExtensionStorageService } from '../platform/extensionManagement/common/extensionStorage.js';
import { IUserDataSyncLogService } from '../platform/userDataSync/common/userDataSync.js';
import { UserDataSyncLogService } from '../platform/userDataSync/common/userDataSyncLog.js';
import { AllowedExtensionsService } from '../platform/extensionManagement/common/allowedExtensionsService.js';
import { IWebWorkerService } from '../platform/webWorker/browser/webWorkerService.js';
import { WebWorkerService } from '../platform/webWorker/browser/webWorkerServiceImpl.js';

registerSingleton(IUserDataSyncLogService, UserDataSyncLogService, InstantiationType.Delayed);
registerSingleton(IAllowedExtensionsService, AllowedExtensionsService, InstantiationType.Delayed);
registerSingleton(IIgnoredExtensionsManagementService, IgnoredExtensionsManagementService, InstantiationType.Delayed);
registerSingleton(IGlobalExtensionEnablementService, GlobalExtensionEnablementService, InstantiationType.Delayed);
registerSingleton(IExtensionStorageService, ExtensionStorageService, InstantiationType.Delayed);
registerSingleton(IContextViewService, ContextViewService, InstantiationType.Delayed);
registerSingleton(IListService, ListService, InstantiationType.Delayed);
registerSingleton(IMarkerDecorationsService, MarkerDecorationsService, InstantiationType.Delayed);
registerSingleton(IMarkerService, MarkerService, InstantiationType.Delayed);
registerSingleton(IContextKeyService, ContextKeyService, InstantiationType.Delayed);
registerSingleton(ITextResourceConfigurationService, TextResourceConfigurationService, InstantiationType.Delayed);
registerSingleton(IDownloadService, DownloadService, InstantiationType.Delayed);
registerSingleton(IOpenerService, OpenerService, InstantiationType.Delayed);
registerSingleton(IWebWorkerService, WebWorkerService, InstantiationType.Delayed);

//#endregion


//#region --- workbench contributions

// Logs

// Quickaccess
import './contrib/quickaccess/browser/quickAccess.contribution.js';

// Explorer
import './contrib/files/browser/explorerViewlet.js';
import './contrib/files/browser/fileActions.contribution.js';
import './contrib/files/browser/files.contribution.js';

// Search
import './contrib/search/browser/search.contribution.js';
import './contrib/search/browser/searchView.js';

// Sash
import './contrib/sash/browser/sash.contribution.js';

// SCM services only (Vacha: git and the SCM UI are removed; these delayed
// singletons stay registered because live code injects them — searchView.
// With no providers they are permanently empty, i.e. de-facto null services.)
import './contrib/scm/browser/quickDiff.contribution.js';
import './contrib/scm/browser/scm.service.contribution.js';

// Commands
import './contrib/commands/common/commands.contribution.js';

// URL Support
import './contrib/url/browser/url.contribution.js';

// Default sidebar view (Explorer on first launch of a workspace)
import './contrib/vacha/browser/defaultSidebar.contribution.js';

// Extension point handlers (language configs, colors, icons — see file)
import './contrib/vacha/browser/extensionPointHandlers.contribution.js';

// Single Explorer pane (Search + Source Control views folded into Explorer)
import './contrib/vacha/browser/unifiedSidebar.contribution.js';

// Close (hide sidebar) button on the sidebar pane headers
import './contrib/vacha/browser/sidebarClose.contribution.js';

// Update check against the Vacha release manifest
import './contrib/vacha/browser/updateCheck.contribution.js';

// Preferences (Settings UI — the editor pane, menus, and the services its
// search and header inject; both AI/chat services are inert in this fork)
import './services/aiSettingsSearch/common/aiSettingsSearchService.js';
import './services/chat/common/chatEntitlementService.js';
import './contrib/preferences/browser/preferences.contribution.js';
import './contrib/preferences/browser/preferencesSearch.js';

// CodeEditor Contributions
import './contrib/codeEditor/browser/codeEditor.contribution.js';

// Vacha: keybindings contribution removed — its only action (Toggle Keyboard
// Shortcuts Troubleshooting) depended on the deleted log viewer.

// Themes
import './contrib/themes/browser/themes.contribution.js';

// Workspace
import './contrib/workspace/browser/workspace.contribution.js';

// Vacha: workspaces.contribution removed — the .code-workspace finder and the
// "Open Workspace" editor button have no workspace concept to serve.

// List
import './contrib/list/browser/list.contribution.js';

// Image Preview
import './contrib/imagePreview/browser/imagePreview.contribution.js';

// Markdown Preview
import './contrib/markdownPreview/browser/markdownPreview.contribution.js';

// Accessibility
import './contrib/accessibility/browser/accessibility.contribution.js';
import './contrib/accessibilitySignals/browser/accessibilitySignal.contribution.js';

// Speech (service only — inert without a speech provider extension, but
// accessibility contributions inject ISpeechService)
import './contrib/speech/browser/speech.contribution.js';

// Bulk Edit (service only — the extension host and file operation
// participants inject IBulkEditService)
import './contrib/bulkEdit/browser/bulkEditService.js';

// Rename Symbol Tracker (service only — inline completions inject it for
// every editor)
import './contrib/inlineCompletions/browser/renameSymbolTrackerService.js';

// Extensions Management (service only — no marketplace UI in this fork, but
// the extension host injects IExtensionsWorkbenchService)
import { IExtensionsWorkbenchService } from './contrib/extensions/common/extensions.js';
import { ExtensionsWorkbenchService } from './contrib/extensions/browser/extensionsWorkbenchService.js';
registerSingleton(IExtensionsWorkbenchService, ExtensionsWorkbenchService, InstantiationType.Delayed);

// Debug (null service — the debug feature is removed in this fork, but kept
// workbench code still injects IDebugService)
import { NullDebugService, NullDebugVisualizerService } from './contrib/debug/common/nullDebugService.js';
import { IDebugService } from './contrib/debug/common/debug.js';
import { IDebugVisualizerService } from './contrib/debug/common/debugVisualizers.js';
registerSingleton(IDebugService, NullDebugService, InstantiationType.Delayed);
registerSingleton(IDebugVisualizerService, NullDebugVisualizerService, InstantiationType.Delayed);

// Data Channels (null service — the data channel feature is removed in this
// fork, but editor telemetry loggers still inject the service)
import { IDataChannelService, NullDataChannelService } from '../platform/dataChannel/common/dataChannel.js';
registerSingleton(IDataChannelService, NullDataChannelService, InstantiationType.Delayed);

// Opener
import './contrib/opener/browser/opener.contribution.js';

//#endregion
