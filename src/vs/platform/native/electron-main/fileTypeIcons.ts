/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { isWindows } from '../../../base/common/platform.js';
import { dirname, extname, join } from '../../../base/common/path.js';
import { ILogService } from '../../log/common/log.js';

/**
 * Vacha: when the user picks Vacha for a file type with "Choose another app",
 * Windows records an `<ext>_auto_file` ProgId without an icon, so those files
 * show a blank page in Explorer. The forwarder shim repairs that: each such
 * type gets the icon Windows registers for it, or Vacha's icon when there is
 * none. Without arguments every auto ProgId is checked (startup); with paths,
 * only those files' types (a file just opened through Vacha).
 */
export function repairFileTypeIcons(logService: ILogService, paths: string[] = []): void {
	if (!isWindows) {
		return;
	}

	const shim = join(dirname(process.execPath), 'vacha_open.exe');
	if (!existsSync(shim)) {
		return; // dev builds have no shim next to the exe
	}

	const extensions = [...new Set(paths.map(path => extname(path).slice(1).toLowerCase()).filter(extension => !!extension))];
	if (paths.length > 0 && extensions.length === 0) {
		return;
	}

	try {
		const child = spawn(shim, ['--fix-file-icons', ...extensions], { detached: true, stdio: 'ignore', windowsHide: true });
		child.on('error', error => logService.error('[file type icons] repair failed to start', error));
		child.unref();
	} catch (error) {
		logService.error('[file type icons] repair failed to start', error);
	}
}
