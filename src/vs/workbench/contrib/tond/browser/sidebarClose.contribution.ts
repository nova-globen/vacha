/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { VIEW_ID as SEARCH_VIEW_ID } from '../../../services/search/common/search.js';
import { OpenEditorsView } from '../../files/browser/views/openEditorsView.js';

const sidebarCloseIcon = registerIcon('tond-sidebar-close', Codicon.close, localize('tondSidebarCloseIcon', 'Icon for the pane-header button that hides the sidebar.'));

/**
 * Tond: the sidebar has no container title bar (`hasTitle: false`) and no
 * activity bar, so without this there is no mouse affordance to close it.
 * The button rides each pane's own header (whichever pane is expanded shows
 * its header actions), on both sidebar panes: Open Editors and Search.
 */
registerAction2(class TondCloseSidebarAction extends Action2 {

	static readonly ID = 'tond.closeSidebar';

	constructor() {
		super({
			id: TondCloseSidebarAction.ID,
			title: localize2('tond.closeSidebar', "Hide Sidebar"),
			f1: false,
			icon: sidebarCloseIcon,
			menu: [
				{
					id: MenuId.ViewTitle,
					group: 'navigation',
					order: 100, // rightmost — after every stock pane action
					when: ContextKeyExpr.equals('view', OpenEditorsView.ID),
				},
				{
					id: MenuId.ViewTitle,
					group: 'navigation',
					order: 100,
					when: ContextKeyExpr.equals('view', SEARCH_VIEW_ID),
				},
			],
		});
	}

	override run(accessor: ServicesAccessor): Promise<unknown> {
		return accessor.get(ICommandService).executeCommand('workbench.action.toggleSidebarVisibility');
	}
});
