/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { Action } from '../../../../base/common/actions.js';
import { IExtensionDescription } from '../../../../platform/extensions/common/extensions.js';

export class ReportExtensionIssueAction extends Action {

	private static readonly _id = 'workbench.extensions.action.reportExtensionIssue';
	private static readonly _label = nls.localize('reportExtensionIssue', "Report Issue");

	constructor(
		extension: IExtensionDescription, // Tond: issue reporter removed; action stays constructible but disabled
	) {
		super(ReportExtensionIssueAction._id, ReportExtensionIssueAction._label, 'extension-action report-issue');

		this.enabled = false;
	}

	override async run(): Promise<void> {
		// Tond: issue reporter removed
	}
}
