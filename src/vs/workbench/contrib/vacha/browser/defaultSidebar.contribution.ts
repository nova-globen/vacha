/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { ViewContainerLocation } from '../../../common/views.js';
import { IPaneCompositePartService } from '../../../services/panecomposite/browser/panecomposite.js';
import { VIEWLET_ID as EXPLORER_VIEWLET_ID } from '../../files/common/files.js';

/**
 * Ensures the Explorer is the sidebar view on the first launch of a
 * workspace. The Explorer container is `hideIfEmpty` and its views register
 * after the sidebar restores, so the initial restore can fall back to the
 * next visible container (Search) and stick there.
 */
class DefaultSidebarViewContribution implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.vachaDefaultSidebarView';

	private static readonly APPLIED_KEY = 'tond.defaultSidebarApplied';

	constructor(
		@IStorageService storageService: IStorageService,
		@IPaneCompositePartService paneCompositePartService: IPaneCompositePartService,
	) {
		if (storageService.getBoolean(DefaultSidebarViewContribution.APPLIED_KEY, StorageScope.WORKSPACE, false)) {
			return;
		}
		storageService.store(DefaultSidebarViewContribution.APPLIED_KEY, true, StorageScope.WORKSPACE, StorageTarget.MACHINE);

		const active = paneCompositePartService.getActivePaneComposite(ViewContainerLocation.Sidebar);
		if (active && active.getId() !== EXPLORER_VIEWLET_ID) {
			paneCompositePartService.openPaneComposite(EXPLORER_VIEWLET_ID, ViewContainerLocation.Sidebar, false);
		}
	}
}

registerWorkbenchContribution2(DefaultSidebarViewContribution.ID, DefaultSidebarViewContribution, WorkbenchPhase.AfterRestored);
