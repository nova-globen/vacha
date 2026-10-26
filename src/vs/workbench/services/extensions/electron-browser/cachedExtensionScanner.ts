/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as platform from '../../../../base/common/platform.js';
import { IExtensionDescription } from '../../../../platform/extensions/common/extensions.js';
import { IExtensionsScannerService, IScannedExtension, toExtensionDescription as toExtensionDescriptionFromScannedExtension } from '../../../../platform/extensionManagement/common/extensionsScannerService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { getErrorMessage } from '../../../../base/common/errors.js';

export class CachedExtensionScanner {

	public readonly scannedExtensions: Promise<IExtensionDescription[]>;
	private _scannedExtensionsResolve!: (result: IExtensionDescription[]) => void;
	private _scannedExtensionsReject!: (err: unknown) => void;

	constructor(
		@IExtensionsScannerService private readonly _extensionsScannerService: IExtensionsScannerService,
		@ILogService private readonly _logService: ILogService,
	) {
		this.scannedExtensions = new Promise<IExtensionDescription[]>((resolve, reject) => {
			this._scannedExtensionsResolve = resolve;
			this._scannedExtensionsReject = reject;
		});
	}

	public async startScanningExtensions(): Promise<void> {
		try {
			const extensions = await this._scanInstalledExtensions();
			this._scannedExtensionsResolve(extensions);
		} catch (err) {
			this._scannedExtensionsReject(err);
		}
	}

	private async _scanInstalledExtensions(): Promise<IExtensionDescription[]> {
		try {
			const language = platform.language;
			const result = await Promise.allSettled([
				this._extensionsScannerService.scanSystemExtensions({ language, checkControlFile: true })
			]);

			let scannedSystemExtensions: IScannedExtension[] = [];
			if (result[0].status === 'fulfilled') {
				scannedSystemExtensions = result[0].value;
			} else {
				this._logService.error(`Error scanning system extensions:`, getErrorMessage(result[0].reason));
			}

			const system = scannedSystemExtensions.map(e => toExtensionDescriptionFromScannedExtension(e, false));
			return system;
		} catch (err) {
			this._logService.error(`Error scanning installed extensions:`);
			this._logService.error(err);
			return [];
		}
	}

}
