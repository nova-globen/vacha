/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorContributionInstantiation, registerEditorContribution } from '../../../../editor/browser/editorExtensions.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from '../../../common/contributions.js';
import { localize } from '../../../../nls.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IQuickDiffService } from '../common/quickDiff.js';
import { QuickDiffService } from '../common/quickDiffService.js';
import { QuickDiffWorkbenchController } from './quickDiffDecorator.js';
import { IQuickDiffModelService, QuickDiffModelService } from './quickDiffModel.js';
import { QuickDiffEditorController } from './quickDiffWidget.js';

MenuRegistry.appendMenuItem(MenuId.EditorLineNumberContext, {
	title: localize('quickDiffDecoration', "Diff Decorations"),
	submenu: MenuId.SCMQuickDiffDecorations,
	when: ContextKeyExpr.or(
		ContextKeyExpr.equals('config.scm.diffDecorations', 'all'),
		ContextKeyExpr.equals('config.scm.diffDecorations', 'gutter')),
	group: '9_quickDiffDecorations'
});

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(QuickDiffWorkbenchController, LifecyclePhase.Restored);

registerEditorContribution(QuickDiffEditorController.ID,
	QuickDiffEditorController, EditorContributionInstantiation.AfterFirstRender);

// Vacha: scm.diffDecorations* settings removed - no quick diff provider can ever register (the services stay for the empty-state contract).

registerSingleton(IQuickDiffService, QuickDiffService, InstantiationType.Delayed);
registerSingleton(IQuickDiffModelService, QuickDiffModelService, InstantiationType.Delayed);
