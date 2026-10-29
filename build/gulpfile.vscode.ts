/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { gulp, rename, replace, filter, jsonEditor } from './lib/gulp/facade.ts';
import * as fs from 'fs';
import * as path from 'path';
import es from 'event-stream';
import vfs from 'vinyl-fs';
import electron from '@vscode/gulp-electron';
import * as util from './lib/util.ts';
import { getVersion } from './lib/getVersion.ts';
import { readISODate, writeISODate } from './lib/date.ts';
import * as task from './lib/gulp/task.ts';
import buildfile from './buildfile.ts';
import * as optimize from './lib/optimize.ts';
import { inlineMeta } from './lib/inlineMeta.ts';
import packageJson from '../package.json' with { type: 'json' };
import product from '../product.json' with { type: 'json' };
import * as cp from 'child_process';
import { getProductionDependencies } from './lib/dependencies.ts';
import { config } from './lib/electron.ts';
import { createAsar } from './lib/asar.ts';
import { compileBuildWithoutManglingTask, compileBuildWithManglingTask } from './gulpfile.compile.ts';
import { compileNonNativeExtensionsBuildTask, compileNativeExtensionsBuildTask, compileAllExtensionsBuildTask, compileExtensionMediaBuildTask, cleanExtensionsBuildTask } from './gulpfile.extensions.ts';
import { copyCodiconsTask } from './lib/compilation.ts';
import { useEsbuildTranspile } from './buildConfig.ts';
import { promisify } from 'util';
import globCallback from 'glob';
import rceditCallback from 'rcedit';
import { spawnTsgo } from './lib/tsgo.ts';
import { runEsbuildTranspile, runEsbuildBundle } from './lib/esbuild.ts';


const glob = promisify(globCallback);
const rcedit = promisify(rceditCallback);
const root = path.dirname(import.meta.dirname);
const commit = getVersion(root);

// Build
const vscodeEntryPoints = [
	buildfile.workerEditor,
	buildfile.workerLocalFileSearch,
	buildfile.workerBackgroundTokenization,
	buildfile.workbenchDesktop,
	buildfile.code
].flat();

const vscodeResourceIncludes = [

	// NLS
	'out-build/nls.messages.json',
	'out-build/nls.keys.json',

	// Workbench
	'out-build/vs/code/electron-browser/workbench/workbench.html',

	// Electron Preload
	'out-build/vs/base/parts/sandbox/electron-browser/preload.js',
	'out-build/vs/base/parts/sandbox/electron-browser/preload-aux.js',

	// Node Scripts
	'out-build/vs/base/node/{terminateProcess.sh,cpuUsage.sh,ps.sh}',

	// Touchbar
	'out-build/vs/workbench/browser/parts/editor/media/*.png',

	// External Terminal
	'out-build/vs/workbench/contrib/externalTerminal/**/*.scpt',

	// Terminal shell integration
	'out-build/vs/workbench/contrib/terminal/common/scripts/*.fish',
	'out-build/vs/workbench/contrib/terminal/common/scripts/*.ps1',
	'out-build/vs/workbench/contrib/terminal/common/scripts/*.psm1',
	'out-build/vs/workbench/contrib/terminal/common/scripts/*.sh',
	'out-build/vs/workbench/contrib/terminal/common/scripts/*.zsh',
	'out-build/vs/workbench/contrib/terminal/common/scripts/psreadline/**',

	// Accessibility Signals
	'out-build/vs/platform/accessibilitySignal/browser/media/*.mp3',

	// Extensions
	'out-build/vs/workbench/contrib/extensions/browser/media/{theme-icon.png,language-icon.svg}',
	'out-build/vs/workbench/services/extensionManagement/common/media/*.{svg,png}',

	// Webview
	'out-build/vs/workbench/contrib/webview/browser/pre/*.{js,html}',

	// Extension Host Worker
	'out-build/vs/workbench/services/extensions/worker/webWorkerExtensionHostIframe.html',

	// Tree Sitter highlights
	'out-build/vs/editor/common/languages/highlights/*.scm',

	// Tree Sitter injection queries
	'out-build/vs/editor/common/languages/injections/*.scm'
];

const vscodeResources = [

	// Includes
	...vscodeResourceIncludes,

	// Excludes
	'!out-build/vs/code/browser/**',
	'!out-build/vs/editor/standalone/**',
	'!out-build/vs/code/**/*-dev.html',
	'!**/test/**'
];

const bootstrapEntryPoints = [
	'out-build/main.js',
	'out-build/cli.js',
	'out-build/bootstrap-fork.js'
];

const bundleVSCodeTask = task.define('bundle-vscode', task.series(
	util.rimraf('out-vscode'),
	// Optimize: bundles source files automatically based on
	// import statements based on the passed in entry points.
	// In addition, concat window related bootstrap files into
	// a single file.
	optimize.bundleTask(
		{
			out: 'out-vscode',
			esm: {
				src: 'out-build',
				entryPoints: [
					...vscodeEntryPoints,
					...bootstrapEntryPoints
				],
				resources: vscodeResources,
				skipTSBoilerplateRemoval: entryPoint => entryPoint === 'vs/code/electron-browser/workbench/workbench'
			}
		}
	)
));
task.task(bundleVSCodeTask);

const sourceMappingURLBase = `https://main.vscode-cdn.net/sourcemaps/${commit}`;
const isCI = !!process.env['CI'] || !!process.env['BUILD_ARTIFACTSTAGINGDIRECTORY'] || !!process.env['GITHUB_WORKSPACE'];
const useCdnSourceMapsForPackagingTasks = isCI;
const stripSourceMapsInPackagingTasks = isCI;
const minifyVSCodeTask = task.define('minify-vscode', task.series(
	bundleVSCodeTask,
	util.rimraf('out-vscode-min'),
	optimize.minifyTask('out-vscode', `${sourceMappingURLBase}/core`)
));
task.task(minifyVSCodeTask);

// Vacha: core-ci-old removed — it referenced the deleted reh (server) minify
// tasks and would crash at execution.

task.task(task.define('core-ci', task.series(
	copyCodiconsTask,
	compileNonNativeExtensionsBuildTask,
	compileExtensionMediaBuildTask,
	writeISODate('out-build'),
	// Type-check with tsgo (no emit)
	task.define('tsgo-typecheck', () => spawnTsgo(path.join(root, 'src', 'tsconfig.json'), { taskName: 'tsgo-typecheck', noEmit: true })),
	// Transpile individual files to out-build first (for unit tests)
	task.define('esbuild-out-build', () => runEsbuildTranspile('out-build', false)),
	// Then bundle for shipping (bundles also write NLS files to out-build)
	// Vacha: desktop is the only build target (server targets removed)
	task.define('esbuild-vscode-min', () => runEsbuildBundle('out-vscode-min', true, true, 'desktop', `${sourceMappingURLBase}/core`))
)));


function packageTask(platform: string, arch: string, sourceFolderName: string, destinationFolderName: string, _opts?: { stats?: boolean }) {
	const destination = path.join(root, 'dist', destinationFolderName);
	platform = platform || process.platform;

	const task = () => {
		const out = sourceFolderName;
		const versionedResourcesFolder = util.getVersionedResourcesFolder(platform, commit!);

		// Vacha: no stamped checksums. The integrity check they feed ran five
		// file reads + hashes through the shared process on every boot, and the
		// shared process deliberately no longer spawns. With no `checksums` in
		// product.json the IntegrityService reports pure without any IO.

		const src = gulp.src(out + '/**', { base: '.' })
			.pipe(rename(function (path) { path.dirname = path.dirname!.replace(new RegExp('^' + out), 'out'); }))
			.pipe(util.setExecutableBit(['**/*.sh']));

		const platformSpecificBuiltInExtensionsExclusions = product.builtInExtensions.filter(ext => {
			if (!(ext as { platforms?: string[] }).platforms) {
				return false;
			}

			const set = new Set((ext as { platforms?: string[] }).platforms);
			return !set.has(platform);
		}).map(ext => `!.build/extensions/${ext.name}/**`);

		const extensions = gulp.src(['.build/extensions/**', '!.build/extensions/node_modules/typescript/**', ...platformSpecificBuiltInExtensionsExclusions], { base: '.build', dot: true });

		const sourceFilterPattern = stripSourceMapsInPackagingTasks
			? ['**', '!**/*.{js,css}.map']
			: ['**'];
		const sources = es.merge(src, extensions)
			.pipe(filter(sourceFilterPattern, { dot: true }));

		let version = packageJson.version;
		const quality = (product as { quality?: string }).quality;

		if (quality && quality !== 'stable') {
			version += '-' + quality;
		}

		const name = product.nameShort;
		const packageJsonUpdates: Record<string, unknown> = { name, version };

		if (platform === 'linux') {
			packageJsonUpdates.desktopName = `${product.applicationName}.desktop`;
		}

		let packageJsonContents: string;
		const packageJsonStream = gulp.src(['package.json'], { base: '.' })
			.pipe(jsonEditor((json: Record<string, unknown>) => {
				Object.assign(json, packageJsonUpdates);
				delete json.scripts;
				delete json.devDependencies;
				return json;
			}))
			.pipe(es.through(function (file) {
				packageJsonContents = file.contents.toString();
				this.emit('data', file);
			}));

		let productJsonContents: string;
		const productJsonStream = gulp.src(['product.json'], { base: '.' })
			.pipe(jsonEditor((json: Record<string, unknown>) => {
				json.commit = commit;
				json.date = readISODate(out);
				json.version = version;
				return json;
			}))
			.pipe(es.through(function (file) {
				productJsonContents = file.contents.toString();
				this.emit('data', file);
			}));

		const license = gulp.src([product.licenseFileName, 'LICENSE.vscode.txt', 'PRICING.md', 'TERMS.md', 'PRIVACY.md', 'ThirdPartyNotices.txt', 'licenses/**'], { base: '.', allowEmpty: true });

		const telemetry = gulp.src('.build/telemetry/**', { base: '.build/telemetry', dot: true });

		const jsFilter = util.filter(data => !data.isDirectory() && /\.js$/.test(data.path));
		const root = path.resolve(path.join(import.meta.dirname, '..'));
		const productionDependencies = getProductionDependencies(root);
		const dependenciesSrc = productionDependencies.map(d => path.relative(root, d)).map(d => [`${d}/**`, `!${d}/**/{test,tests}/**`]).flat().concat('!**/*.mk');

		const depFilterPattern = ['**', `!**/${config.version}/**`, '!**/bin/darwin-arm64-87/**', '!**/package-lock.json', '!**/yarn.lock'];
		if (stripSourceMapsInPackagingTasks) {
			depFilterPattern.push('!**/*.{js,css}.map');
		}

		const cleanedDeps = gulp.src(dependenciesSrc, { base: '.', dot: true })
			.pipe(filter(depFilterPattern))
			.pipe(util.cleanNodeModules(path.join(import.meta.dirname, '.moduleignore')))
			.pipe(util.cleanNodeModules(path.join(import.meta.dirname, `.moduleignore.${process.platform}`)));
		// Vacha: no ripgrep and no agent SDK ship, so their per-platform
		// filter and product.json stamp (build/lib/copilot.ts, build/agent-sdk) are gone
		const deps = cleanedDeps
			.pipe(jsFilter)
			.pipe(util.rewriteSourceMappingURL(sourceMappingURLBase))
			.pipe(jsFilter.restore)
			.pipe(createAsar(path.join(process.cwd(), 'node_modules'), [
				'**/*.node',
				'**/@vscode/ripgrep-universal/bin/**',
				'**/node-pty/build/Release/*',
				'**/node-pty/build/Release/conpty/*',
				'**/node-pty/lib/worker/conoutSocketWorker.js',
				'**/node-pty/lib/shared/conout.js',
				'**/*.wasm',
				'**/@vscode/vsce-sign/bin/*',
			], [
				'**/*.mk',
				'!node_modules/vsda/**' // stay compatible with extensions that depend on us shipping `vsda` into ASAR
			], [
				'node_modules/vsda/**' // retain copy of `vsda` in node_modules for internal use
			], 'node_modules.asar'));

		const mergeStreams = [
			packageJsonStream,
			productJsonStream,
			license,
			telemetry,
			sources,
			deps
		];
		let all = es.merge(...mergeStreams);

		if (platform === 'win32') {
			// Vacha: the per-language association icons are gone — Vacha claims a
			// handful of plain-text extensions and offers "Open with" for the
			// rest, all of which use the app icon.
			all = es.merge(all, gulp.src([
				'resources/win32/code.ico',
				'resources/win32/vacha-tray.ico',
				'resources/win32/code_70x70.png',
				'resources/win32/code_150x150.png'
			], { base: '.' }));
		} else if (platform === 'linux') {
			const policyDest = gulp.src('.build/policies/linux/**', { base: '.build/policies/linux' })
				.pipe(rename(f => f.dirname = `policies/${f.dirname}`));
			all = es.merge(all, gulp.src('resources/linux/code.png', { base: '.' }), policyDest);
		} else if (platform === 'darwin') {
			const shortcut = gulp.src('resources/darwin/bin/code.sh')
				.pipe(replace('@@APPNAME@@', product.applicationName))
				.pipe(replace('@@NAME@@', product.nameShort))
				.pipe(rename('bin/code'));
			const policyDest = gulp.src('.build/policies/darwin/**', { base: '.build/policies/darwin' })
				.pipe(rename(f => f.dirname = `policies/${f.dirname}`));
			all = es.merge(all, shortcut, policyDest);
		}

		const electronConfig = {
			...config,
			platform,
			arch: arch === 'armhf' ? 'arm' : arch,
			ffmpegChromium: false
		};

		let result: NodeJS.ReadWriteStream = all
			.pipe(util.skipDirectories())
			.pipe(util.fixWin32DirectoryPermissions())
			.pipe(filter(['**', '!**/.github/**'], { dot: true })) // https://github.com/microsoft/vscode/issues/116523
			.pipe(electron(electronConfig))
			.pipe(filter([
				'**',
				'!LICENSE',
				'!version',
				...(platform === 'darwin' ? ['!**/Contents/Applications', '!**/Contents/Applications/**'] : []),
				...(platform === 'win32' ? ['!**/electron_proxy.exe'] : []),
			], { dot: true }));

		if (platform === 'linux') {
			result = es.merge(result, gulp.src('resources/completions/bash/code', { base: '.' })
				.pipe(replace('@@APPNAME@@', product.applicationName))
				.pipe(rename(function (f) { f.basename = product.applicationName; })));

			result = es.merge(result, gulp.src('resources/completions/zsh/_code', { base: '.' })
				.pipe(replace('@@APPNAME@@', product.applicationName))
				.pipe(rename(function (f) { f.basename = '_' + product.applicationName; })));
		}

		if (platform === 'win32') {
			result = es.merge(result, gulp.src('resources/win32/bin/code.js', { base: 'resources/win32', allowEmpty: true }));

			if (versionedResourcesFolder) {
				result = es.merge(result, gulp.src('resources/win32/versioned/bin/code.cmd', { base: 'resources/win32/versioned' })
					.pipe(replace('@@NAME@@', product.nameShort))
					.pipe(replace('@@VERSIONFOLDER@@', versionedResourcesFolder))
					.pipe(rename(function (f) { f.basename = product.applicationName; })));

				result = es.merge(result, gulp.src('resources/win32/versioned/bin/code.sh', { base: 'resources/win32/versioned' })
					.pipe(replace('@@NAME@@', product.nameShort))
					.pipe(replace('@@PRODNAME@@', product.nameLong))
					.pipe(replace('@@VERSION@@', version))
					.pipe(replace('@@COMMIT@@', String(commit)))
					.pipe(replace('@@APPNAME@@', product.applicationName))
					.pipe(replace('@@VERSIONFOLDER@@', versionedResourcesFolder))
					.pipe(replace('@@SERVERDATAFOLDER@@', product.serverDataFolderName || '.vscode-remote'))
					.pipe(replace('@@QUALITY@@', quality!))
					.pipe(rename(function (f) { f.basename = product.applicationName; f.extname = ''; })));
			} else {
				result = es.merge(result, gulp.src('resources/win32/bin/code.cmd', { base: 'resources/win32' })
					.pipe(replace('@@NAME@@', product.nameShort))
					.pipe(rename(function (f) { f.basename = product.applicationName; })));

				result = es.merge(result, gulp.src('resources/win32/bin/code.sh', { base: 'resources/win32' })
					.pipe(replace('@@NAME@@', product.nameShort))
					.pipe(replace('@@PRODNAME@@', product.nameLong))
					.pipe(replace('@@VERSION@@', version))
					.pipe(replace('@@COMMIT@@', String(commit)))
					.pipe(replace('@@APPNAME@@', product.applicationName))
					.pipe(replace('@@SERVERDATAFOLDER@@', product.serverDataFolderName || '.vscode-remote'))
					.pipe(replace('@@QUALITY@@', String(quality)))
					.pipe(rename(function (f) { f.basename = product.applicationName; f.extname = ''; })));
			}

			result = es.merge(result, gulp.src('resources/win32/VisualElementsManifest.xml', { base: 'resources/win32' })
				.pipe(replace('@@VERSIONFOLDER@@', versionedResourcesFolder ? `${versionedResourcesFolder}\\` : ''))
				.pipe(rename(product.nameShort + '.VisualElementsManifest.xml')));

			result = es.merge(result, gulp.src('.build/policies/win32/**', { base: '.build/policies/win32' })
				.pipe(rename(f => f.dirname = `policies/${f.dirname}`)));

			if (quality === 'stable' || quality === 'insider') {
				result = es.merge(result, gulp.src('.build/win32/appx/**', { base: '.build/win32' }));
				const rawVersion = version.replace(/-\w+$/, '').split('.');
				const appxVersion = `${rawVersion[0]}.0.${rawVersion[1]}.${rawVersion[2]}`;
				result = es.merge(result, gulp.src('resources/win32/appx/AppxManifest.xml', { base: '.' })
					.pipe(replace('@@AppxPackageName@@', product.win32AppUserModelId))
					.pipe(replace('@@AppxPackageVersion@@', appxVersion))
					.pipe(replace('@@AppxPackageDisplayName@@', product.nameLong))
					.pipe(replace('@@AppxPackageDescription@@', product.win32NameVersion))
					.pipe(replace('@@ApplicationIdShort@@', product.win32RegValueName))
					.pipe(replace('@@ApplicationExe@@', product.nameShort + '.exe'))
					.pipe(replace('@@FileExplorerContextMenuID@@', quality === 'stable' ? 'OpenWithCode' : 'OpenWithCodeInsiders'))
					.pipe(replace('@@FileExplorerContextMenuCLSID@@', (product as { win32ContextMenu?: Record<string, { clsid: string }> }).win32ContextMenu![arch].clsid))
					.pipe(replace('@@FileExplorerContextMenuDLL@@', `${quality === 'stable' ? 'code' : 'code_insider'}_explorer_command_${arch}.dll`))
					.pipe(rename(f => f.dirname = `appx/manifest`)));
			}
		} else if (platform === 'linux') {
			result = es.merge(result, gulp.src('resources/linux/bin/code.sh', { base: '.' })
				.pipe(replace('@@PRODNAME@@', product.nameLong))
				.pipe(replace('@@APPNAME@@', product.applicationName))
				.pipe(rename('bin/' + product.applicationName)));
		}

		result = inlineMeta(result, {
			targetPaths: bootstrapEntryPoints,
			packageJsonFn: () => packageJsonContents,
			productJsonFn: () => productJsonContents
		});

		return result.pipe(vfs.dest(destination));
	};
	task.taskName = `package-${platform}-${arch}`;
	return task;
}

function hasAuthenticodeSignature(filePath: string): Promise<boolean> {
	return new Promise((resolve, reject) => {
		const proc = cp.spawn('signtool.exe', ['verify', '/pa', filePath]);
		proc.on('error', (error: NodeJS.ErrnoException) => {
			if (error.code === 'ENOENT') {
				// signtool is not installed (unsigned local/CI builds): treat
				// inputs as unsigned so packaging can complete
				resolve(false);
			} else {
				reject(error);
			}
		});
		proc.on('exit', code => resolve(code === 0));
	});
}

async function stripAuthenticodeSignature(filePath: string): Promise<void> {
	// ESRP's `signtool /as` (append) fails with 0x800700C1 on PEs whose existing
	// Authenticode signature was invalidated by rcedit. Strip cleanly first so
	// rcedit operates on an unsigned PE.
	if (!await hasAuthenticodeSignature(filePath)) {
		return;
	}
	await new Promise<void>((resolve, reject) => {
		const proc = cp.spawn('signtool.exe', ['remove', '/s', filePath]);
		let out = '';
		proc.stdout?.on('data', chunk => out += chunk.toString());
		proc.stderr?.on('data', chunk => out += chunk.toString());
		proc.on('error', reject);
		proc.on('exit', code => {
			if (code === 0) {
				resolve();
			} else {
				process.stderr.write(out);
				reject(new Error(`signtool remove /s failed for ${filePath} (exit ${code})`));
			}
		});
	});
}

function patchWin32DependenciesTask(destinationFolderName: string) {
	const cwd = path.join(root, 'dist', destinationFolderName);

	return async () => {
		const versionedResourcesFolder = util.getVersionedResourcesFolder('win32', commit!);
		const deps = (await Promise.all([
			glob('**/*.node', { cwd, ignore: 'extensions/node_modules/@parcel/watcher/**' }),
			glob('**/rg.exe', { cwd }),
			glob('**/tgrep.exe', { cwd }),
			glob('**/*explorer_command*.dll', { cwd }),
		])).flatMap(o => o);
		const packageJson = JSON.parse(await fs.promises.readFile(path.join(cwd, versionedResourcesFolder, 'resources', 'app', 'package.json'), 'utf8'));
		const product = JSON.parse(await fs.promises.readFile(path.join(cwd, versionedResourcesFolder, 'resources', 'app', 'product.json'), 'utf8'));
		const baseVersion = packageJson.version.replace(/-.*$/, '');

		const patchPromises = deps.map<Promise<unknown>>(async dep => {
			const basename = path.basename(dep);
			const fullPath = path.join(cwd, dep);

			await stripAuthenticodeSignature(fullPath);
			await rcedit(fullPath, {
				'file-version': baseVersion,
				'version-string': {
					'CompanyName': 'Nova Globen AB',
					'FileDescription': product.nameLong,
					'FileVersion': packageJson.version,
					'InternalName': basename,
					'LegalCopyright': 'Copyright (C) 2026 Nova Globen AB. All rights reserved.',
					'OriginalFilename': basename,
					'ProductName': product.nameLong,
					'ProductVersion': packageJson.version,
				}
			});
		});

		await Promise.all(patchPromises);
	};
}

const buildRoot = path.join(root, 'dist');

const BUILD_TARGETS = [
	{ platform: 'win32', arch: 'x64' },
	{ platform: 'win32', arch: 'arm64' },
	{ platform: 'darwin', arch: 'x64', opts: { stats: true } },
	{ platform: 'darwin', arch: 'arm64', opts: { stats: true } },
	{ platform: 'linux', arch: 'x64' },
	{ platform: 'linux', arch: 'armhf' },
	{ platform: 'linux', arch: 'arm64' },
];
BUILD_TARGETS.forEach(buildTarget => {
	const dashed = (str: string) => (str ? `-${str}` : ``);
	const platform = buildTarget.platform;
	const arch = buildTarget.arch;
	const opts = buildTarget.opts;

	const [vscode, vscodeMin] = ['', 'min'].map(minified => {
		const sourceFolderName = `out-vscode${dashed(minified)}`;
		const destinationFolderName = `${platform}${dashed(arch)}`;

		const packageTasks: task.Task[] = [
			compileNativeExtensionsBuildTask,
			util.rimraf(path.join(buildRoot, destinationFolderName)),
			packageTask(platform, arch, sourceFolderName, destinationFolderName, opts)
		];

		if (platform === 'win32') {
			packageTasks.push(patchWin32DependenciesTask(destinationFolderName));
		}

		const vscodeTaskCI = task.define(`vscode${dashed(platform)}${dashed(arch)}${dashed(minified)}-ci`, task.series(...packageTasks));
		task.task(vscodeTaskCI);

		let vscodeTask: task.Task;
		if (useEsbuildTranspile) {
			const esbuildBundleTask = task.define(
				`esbuild-bundle${dashed(platform)}${dashed(arch)}${dashed(minified)}`,
				() => runEsbuildBundle(
					sourceFolderName,
					!!minified,
					true,
					'desktop',
					minified && useCdnSourceMapsForPackagingTasks ? `${sourceMappingURLBase}/core` : undefined
				)
			);
			vscodeTask = task.define(`vscode${dashed(platform)}${dashed(arch)}${dashed(minified)}`, task.series(
				copyCodiconsTask,
				cleanExtensionsBuildTask,
				compileNonNativeExtensionsBuildTask,
				compileExtensionMediaBuildTask,
				writeISODate('out-build'),
				esbuildBundleTask,
				vscodeTaskCI
			));
		} else {
			vscodeTask = task.define(`vscode${dashed(platform)}${dashed(arch)}${dashed(minified)}`, task.series(
				minified ? compileBuildWithManglingTask : compileBuildWithoutManglingTask,
				cleanExtensionsBuildTask,
				compileNonNativeExtensionsBuildTask,
				compileExtensionMediaBuildTask,
				minified ? minifyVSCodeTask : bundleVSCodeTask,
				vscodeTaskCI
			));
		}
		task.task(vscodeTask);

		return vscodeTask;
	});

	if (process.platform === platform && process.arch === arch) {
		task.task(task.define('vscode', task.series(vscode)));
		task.task(task.define('vscode-min', task.series(vscodeMin)));
	}
});

// Vacha: the Microsoft translation export/import tasks are gone with the
// Inno Setup language files; the product ships English-only.
