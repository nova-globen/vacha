/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ISearchModel } from './searchTreeCommon.js';

export const ISearchViewModelWorkbenchService = createDecorator<ISearchViewModelWorkbenchService>('searchViewModelWorkbenchService');

export interface ISearchViewModelWorkbenchService {
	readonly _serviceBrand: undefined;

	searchModel: ISearchModel;

	/**
	 * Vacha: makes `searchModel` the active model without disposing the previous
	 * one (unlike the setter). Returns the previous model, which the caller now
	 * owns. Used by the per-file search state cache in the search view.
	 */
	swapSearchModel(searchModel: ISearchModel): ISearchModel | null;
}
