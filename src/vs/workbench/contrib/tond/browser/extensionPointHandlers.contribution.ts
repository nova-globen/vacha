/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { LanguageConfigurationFileHandler } from '../../codeEditor/common/languageConfigurationExtensionPoint.js';
import { ColorExtensionPoint } from '../../../services/themes/common/colorExtensionPoint.js';
import { IconExtensionPoint } from '../../../services/themes/common/iconExtensionPoint.js';
import { TokenClassificationExtensionPoints } from '../../../services/themes/common/tokenClassificationExtensionPoint.js';
import { CSSExtensionPoint } from '../../../services/themes/browser/cssExtensionPoint.js';

/**
 * Tond: the upstream ExtensionPoints contribution lived in the deleted
 * extension-host API layer (extensionHost.contribution.ts). These handlers
 * are what turn the *declarative* built-in extension manifests into editor
 * behavior — most critically LanguageConfigurationFileHandler, which loads
 * every language's language-configuration.json (comments, brackets,
 * auto-closing pairs, indentation and onEnter rules, folding markers).
 * Without it, comment toggling and auto-closing silently die for all
 * languages while syntax highlighting keeps working.
 */
class TondExtensionPointHandlers implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.tondExtensionPointHandlers';

	constructor(@IInstantiationService instantiationService: IInstantiationService) {
		instantiationService.createInstance(LanguageConfigurationFileHandler);
		instantiationService.createInstance(ColorExtensionPoint);
		instantiationService.createInstance(IconExtensionPoint);
		instantiationService.createInstance(TokenClassificationExtensionPoints);
		instantiationService.createInstance(CSSExtensionPoint);
	}
}

registerWorkbenchContribution2(TondExtensionPointHandlers.ID, TondExtensionPointHandlers, WorkbenchPhase.BlockRestore);
