/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Parser, Language, Query } from '@vscode/tree-sitter-wasm';
import { IReader } from '../../../../base/common/observable.js';
import { ITreeSitterLibraryService } from '../../../../editor/common/services/treeSitter/treeSitterLibraryService.js';
import { ITreeSitterThemeService } from '../../../../editor/common/services/treeSitter/treeSitterThemeService.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { TreeSitterThemeService } from './treeSitterThemeService.js';

/**
 * Vacha: highlighting is TextMate only. Tree-sitter parsing was an opt-in
 * experiment; without it the 4 MB @vscode/tree-sitter-wasm package does not
 * ship, so no language reports tree-sitter support.
 */
class NullTreeSitterLibraryService implements ITreeSitterLibraryService {
	readonly _serviceBrand: undefined;

	getParserClass(): Promise<typeof Parser> {
		throw new Error('tree-sitter is not available in Vacha');
	}

	supportsLanguage(languageId: string, reader: IReader | undefined): boolean {
		return false;
	}

	getLanguage(languageId: string, ignoreSupportsCheck: boolean, reader: IReader | undefined): Language | undefined {
		return undefined;
	}

	async getLanguagePromise(languageId: string): Promise<Language | undefined> {
		return undefined;
	}

	getInjectionQueries(languageId: string, reader: IReader | undefined): Query | null | undefined {
		return null;
	}

	getHighlightingQueries(languageId: string, reader: IReader | undefined): Query | null | undefined {
		return null;
	}

	async createQuery(language: Language, querySource: string): Promise<Query> {
		throw new Error('tree-sitter is not available in Vacha');
	}
}

registerSingleton(ITreeSitterLibraryService, NullTreeSitterLibraryService, InstantiationType.Eager);
registerSingleton(ITreeSitterThemeService, TreeSitterThemeService, InstantiationType.Eager);
