/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as nls from '../../../../nls.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import * as Constants from '../common/constants.js';
import { IsSessionsWindowContext } from '../../../common/contextkeys.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { category, findInFilesCommand, IFindInFilesArgs } from './searchActionsBase.js';

// Vacha: the folder- and file-pattern search actions (Restrict Search to Folder,
// Exclude Folder/File Type from Search, Find in Folder/Workspace) are gone —
// the search pane always scopes to the active file and has no include/exclude UI.
// Also gone: search.action.expandRecursively (folder-match tree op) and
// search.action.revealInSideBar (needs the unregistered file tree).

// Find in Files is the same as View: Show Search.
registerAction2(class FindInFilesAction extends Action2 {

	constructor(
	) {
		super({
			id: Constants.SearchCommandIds.FindInFilesActionId,
			title: {
				...nls.localize2('findInFiles', "Find in Files"),
				mnemonicTitle: nls.localize({ key: 'miFindInFiles', comment: ['&& denotes a mnemonic'] }, "Search &&in File"),
			},
			metadata: {
				description: nls.localize('findInFiles.description', "Open a workspace search"),
				args: [
					{
						name: nls.localize('findInFiles.args', "A set of options for the search"),
						schema: {
							type: 'object',
							properties: {
								query: { 'type': 'string' },
								replace: { 'type': 'string' },
								preserveCase: { 'type': 'boolean' },
								triggerSearch: { 'type': 'boolean' },
								isRegex: { 'type': 'boolean' },
								isCaseSensitive: { 'type': 'boolean' },
								matchWholeWord: { 'type': 'boolean' }
							}
						}
					},
				]
			},
			category,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyF,
			},
			menu: [{
				id: MenuId.MenubarEditMenu,
				group: '4_find_global',
				order: 1,
				when: IsSessionsWindowContext.negate(),
			}],
			f1: true,
			precondition: IsSessionsWindowContext.negate()
		});

	}

	override async run(accessor: ServicesAccessor, args: IFindInFilesArgs = {}): Promise<any> {
		findInFilesCommand(accessor, args);
	}
});
