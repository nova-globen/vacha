/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../platform/registry/common/platform.js';
import { localize, localize2 } from '../../nls.js';
import { MenuRegistry, MenuId, registerAction2 } from '../../platform/actions/common/actions.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope } from '../../platform/configuration/common/configurationRegistry.js';
import { KeyMod, KeyCode } from '../../base/common/keyCodes.js';
import { isLinux, isMacintosh, isWindows } from '../../base/common/platform.js';
import { ConfigureRuntimeArgumentsAction, ToggleDevToolsAction, OpenUserDataFolderAction, ShowGPUInfoAction, ShowContentTracingAction, StopTracing, StartTracing, StartHeapTracing } from './actions/developerActions.js';
import { ZoomResetAction, ZoomOutAction, ZoomInAction, CloseWindowAction, SwitchToMainWindowAction, NewWindowTabHandler, ShowPreviousWindowTabHandler, ShowNextWindowTabHandler, MoveWindowTabToNewWindowHandler, MergeWindowTabsHandlerHandler, ToggleWindowTabsBarHandler, ToggleWindowAlwaysOnTopAction, DisableWindowAlwaysOnTopAction, EnableWindowAlwaysOnTopAction } from './actions/windowActions.js';
import { ContextKeyExpr } from '../../platform/contextkey/common/contextkey.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../platform/keybinding/common/keybindingsRegistry.js';
import { CommandsRegistry } from '../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../platform/instantiation/common/instantiation.js';
import { IsMacContext } from '../../platform/contextkey/common/contextkeys.js';
import { INativeHostService } from '../../platform/native/common/native.js';
import { IJSONContributionRegistry, Extensions as JSONExtensions } from '../../platform/jsonschemas/common/jsonContributionRegistry.js';
import { IJSONSchema } from '../../base/common/jsonSchema.js';
import { InstallShellScriptAction, UninstallShellScriptAction } from './actions/installActions.js';
import { EditorsVisibleContext, SingleEditorGroupsContext } from '../common/contextkeys.js';
import { TELEMETRY_SETTING_ID } from '../../platform/telemetry/common/telemetry.js';
import { IConfigurationService } from '../../platform/configuration/common/configuration.js';
import { ShutdownReason } from '../services/lifecycle/common/lifecycle.js';
import { NativeWindow } from './window.js';
import { ModifierKeyEmitter } from '../../base/browser/dom.js';
import { applicationConfigurationNodeBase, securityConfigurationNodeBase } from '../common/configuration.js';
import { MAX_ZOOM_LEVEL, MIN_ZOOM_LEVEL } from '../../platform/window/electron-browser/window.js';
import product from '../../platform/product/common/product.js';

// Actions
(function registerActions(): void {

	// Actions: Zoom
	registerAction2(ZoomInAction);
	registerAction2(ZoomOutAction);
	registerAction2(ZoomResetAction);

	// Actions: Window
	registerAction2(SwitchToMainWindowAction);
	registerAction2(CloseWindowAction);
	registerAction2(ToggleWindowAlwaysOnTopAction);
	registerAction2(EnableWindowAlwaysOnTopAction);
	registerAction2(DisableWindowAlwaysOnTopAction);

	if (isMacintosh) {
		// macOS: behave like other native apps that have documents
		// but can run without a document opened and allow to close
		// the window when the last document is closed
		// (https://github.com/microsoft/vscode/issues/126042)
		KeybindingsRegistry.registerKeybindingRule({
			id: CloseWindowAction.ID,
			weight: KeybindingWeight.WorkbenchContrib,
			when: ContextKeyExpr.and(EditorsVisibleContext.toNegated(), SingleEditorGroupsContext),
			primary: KeyMod.CtrlCmd | KeyCode.KeyW
		});
	}

	// Actions: Install Shell Script (macOS only)
	if (isMacintosh) {
		registerAction2(InstallShellScriptAction);
		registerAction2(UninstallShellScriptAction);
	}

	// Quit
	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: 'workbench.action.quit',
		weight: KeybindingWeight.WorkbenchContrib,
		async handler(accessor: ServicesAccessor) {
			const nativeHostService = accessor.get(INativeHostService);
			const configurationService = accessor.get(IConfigurationService);

			const confirmBeforeClose = configurationService.getValue<'always' | 'never' | 'keyboardOnly'>('window.confirmBeforeClose');
			if (confirmBeforeClose === 'always' || (confirmBeforeClose === 'keyboardOnly' && ModifierKeyEmitter.getInstance().isModifierPressed)) {
				const confirmed = await NativeWindow.confirmOnShutdown(accessor, ShutdownReason.QUIT);
				if (!confirmed) {
					return; // quit prevented by user
				}
			}

			nativeHostService.quit();
		},
		when: undefined,
		mac: { primary: KeyMod.CtrlCmd | KeyCode.KeyQ },
		linux: { primary: KeyMod.CtrlCmd | KeyCode.KeyQ }
	});

	// Actions: macOS Native Tabs
	if (isMacintosh) {
		for (const command of [
			{ handler: NewWindowTabHandler, id: 'workbench.action.newWindowTab', title: localize2('newTab', 'New Window Tab') },
			{ handler: ShowPreviousWindowTabHandler, id: 'workbench.action.showPreviousWindowTab', title: localize2('showPreviousTab', 'Show Previous Window Tab') },
			{ handler: ShowNextWindowTabHandler, id: 'workbench.action.showNextWindowTab', title: localize2('showNextWindowTab', 'Show Next Window Tab') },
			{ handler: MoveWindowTabToNewWindowHandler, id: 'workbench.action.moveWindowTabToNewWindow', title: localize2('moveWindowTabToNewWindow', 'Move Window Tab to New Window') },
			{ handler: MergeWindowTabsHandlerHandler, id: 'workbench.action.mergeAllWindowTabs', title: localize2('mergeAllWindowTabs', 'Merge All Windows') },
			{ handler: ToggleWindowTabsBarHandler, id: 'workbench.action.toggleWindowTabsBar', title: localize2('toggleWindowTabsBar', 'Toggle Window Tabs Bar') }
		]) {
			CommandsRegistry.registerCommand(command.id, command.handler);

			MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
				command,
				when: ContextKeyExpr.equals('config.window.nativeTabs', true)
			});
		}
	}

	// Actions: Developer
	registerAction2(ConfigureRuntimeArgumentsAction);
	registerAction2(ToggleDevToolsAction);
	registerAction2(OpenUserDataFolderAction);
	registerAction2(ShowGPUInfoAction);
	registerAction2(ShowContentTracingAction);
	registerAction2(StopTracing);
	registerAction2(StartTracing);
	registerAction2(StartHeapTracing);
})();

// Menu
(function registerMenu(): void {

	// Quit
	MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
		group: 'z_Exit',
		command: {
			id: 'workbench.action.quit',
			title: localize({ key: 'miExit', comment: ['&& denotes a mnemonic'] }, "E&&xit")
		},
		order: 1,
		when: IsMacContext.toNegated()
	});
})();

// Configuration
(function registerConfiguration(): void {
	const registry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

	// Application
	registry.registerConfiguration({
		...applicationConfigurationNodeBase,
		'properties': {
			'application.shellEnvironmentResolutionTimeout': {
				'type': 'number',
				'default': 10,
				'minimum': 1,
				'maximum': 120,
				'included': !isWindows,
				'scope': ConfigurationScope.APPLICATION,
				'markdownDescription': localize('application.shellEnvironmentResolutionTimeout', "Controls the timeout in seconds before giving up resolving the shell environment when the application is not already launched from a terminal. See our [documentation](https://go.microsoft.com/fwlink/?linkid=2149667) for more information.")
			}
		}
	});

	// Window
	registry.registerConfiguration({
		'id': 'window',
		'order': 8,
		'title': localize('windowConfigurationTitle', "Window"),
		'type': 'object',
		'properties': {
			// Vacha: window.restoreWindows / .newWindowDimensions / .openWithoutArgumentsInNewWindow / .nativeTabs removed - Vacha is single-instance and never opens a second window.
			'window.startAtLogin': {
				'type': 'boolean',
				'default': true,
				'scope': ConfigurationScope.APPLICATION,
				'included': isWindows,
				'description': localize('startAtLogin', "Start Vacha hidden when you sign in to Windows, so the first file of the day opens instantly. Vacha stays in the notification area either way; closing the window hides it and 'Quit Vacha' in the tray menu exits fully.")
			},
			'window.restoreFullscreen': {
				'type': 'boolean',
				'default': false,
				'scope': ConfigurationScope.APPLICATION,
				'description': localize('restoreFullscreen', "Controls whether a window should restore to full screen mode if it was exited in full screen mode.")
			},
			'window.zoomLevel': {
				'type': 'number',
				'default': 0,
				'minimum': MIN_ZOOM_LEVEL,
				'maximum': MAX_ZOOM_LEVEL,
				'markdownDescription': localize({ comment: ['{0} will be a setting name rendered as a link'], key: 'zoomLevel' }, "Adjust the default zoom level for all windows. Each increment above `0` (e.g. `1`) or below (e.g. `-1`) represents zooming `20%` larger or smaller. You can also enter decimals to adjust the zoom level with a finer granularity. See {0} for configuring if the 'Zoom In' and 'Zoom Out' commands apply the zoom level to all windows or only the active window.", '`#window.zoomPerWindow#`'),
				ignoreSync: true,
				tags: ['accessibility']
			},
			'window.zoomPerWindow': {
				'type': 'boolean',
				'default': true,
				'markdownDescription': localize({ comment: ['{0} will be a setting name rendered as a link'], key: 'zoomPerWindow' }, "Controls if the 'Zoom In' and 'Zoom Out' commands apply the zoom level to all windows or only the active window. See {0} for configuring a default zoom level for all windows.", '`#window.zoomLevel#`'),
				tags: ['accessibility']
			},
			'window.closeWhenEmpty': {
				'type': 'boolean',
				'default': false,
				'description': localize('closeWhenEmpty', "Controls whether closing the last editor should also close the window. This setting only applies for windows that do not show folders.")
			},
			'window.doubleClickIconToClose': {
				'type': 'boolean',
				'default': false,
				'scope': ConfigurationScope.APPLICATION,
				'markdownDescription': localize('window.doubleClickIconToClose', "If enabled, this setting will close the window when the application icon in the title bar is double-clicked. The window will not be able to be dragged by the icon. This setting is effective only if {0} is set to `custom`.", '`#window.titleBarStyle#`')
			},
			'window.titleBarStyle': {
				'type': 'string',
				'enum': ['native', 'custom'],
				'default': 'custom',
				'scope': ConfigurationScope.APPLICATION,
				'description': localize('titleBarStyle', "Adjust the appearance of the window title bar to be native by the OS or custom. Changes require a full restart to apply."),
			},
			'window.controlsStyle': {
				'type': 'string',
				'enum': ['native', 'custom', 'hidden'],
				'default': 'native',
				'included': !isMacintosh,
				'scope': ConfigurationScope.APPLICATION,
				'description': localize('controlsStyle', "Adjust the appearance of the window controls to be native by the OS, custom drawn or hidden. Changes require a full restart to apply."),
			},
			'window.customTitleBarVisibility': {
				'type': 'string',
				'enum': ['auto', 'windowed', 'never'],
				'markdownEnumDescriptions': [
					localize(`window.customTitleBarVisibility.auto`, "Automatically changes custom title bar visibility."),
					localize(`window.customTitleBarVisibility.windowed`, "Hide custom titlebar in full screen. When not in full screen, automatically change custom title bar visibility."),
					localize(`window.customTitleBarVisibility.never`, "Hide custom titlebar when {0} is set to `native`.", '`#window.titleBarStyle#`'),
				],
				'default': 'auto',
				'scope': ConfigurationScope.APPLICATION,
				'markdownDescription': localize('window.customTitleBarVisibility', "Adjust when the custom title bar should be shown. The custom title bar can be hidden when in full screen mode with `windowed`. The custom title bar can only be hidden in non full screen mode with `never` when {0} is set to `native`.", '`#window.titleBarStyle#`'),
			},
			'window.menuStyle': {
				'type': 'string',
				'enum': ['custom', 'native', 'inherit'],
				'markdownEnumDescriptions': isMacintosh ?
					[
						localize(`window.menuStyle.custom.mac`, "Use the custom context menu."),
						localize(`window.menuStyle.native.mac`, "Use the native context menu."),
						localize(`window.menuStyle.inherit.mac`, "Matches the context menu style to the title bar style defined in {0}.", '`#window.titleBarStyle#`'),
					] :
					[
						localize(`window.menuStyle.custom`, "Use the custom menu."),
						localize(`window.menuStyle.native`, "Use the native menu. This is ignored when {0} is set to {1}.", '`#window.titleBarStyle#`', '`custom`'),
						localize(`window.menuStyle.inherit`, "Matches the menu style to the title bar style defined in {0}.", '`#window.titleBarStyle#`'),
					],
				'default': product.quality !== 'stable' ? 'inherit' : (isMacintosh ? 'native' : 'inherit'), // TODO@bpasero figure out the default
				'scope': ConfigurationScope.APPLICATION,
				'markdownDescription': isMacintosh ?
					localize('window.menuStyle.mac', "Adjust the context menu appearances to either be native by the OS, custom, or inherited from the title bar style defined in {0}.", '`#window.titleBarStyle#`') :
					localize('window.menuStyle', "Adjust the menu style to either be native by the OS, custom, or inherited from the title bar style defined in {0}. This also affects the context menu appearance. Changes require a full restart to apply.", '`#window.titleBarStyle#`'),
				agentsWindow: { default: 'custom' },
			},
			'window.dialogStyle': {
				'type': 'string',
				'enum': ['native', 'custom'],
				'default': 'native',
				'scope': ConfigurationScope.APPLICATION,
				'description': localize('dialogStyle', "Adjust the appearance of dialogs to be native by the OS or custom."),
				agentsWindow: { default: 'custom' },
			},
			'window.nativeFullScreen': {
				'type': 'boolean',
				'default': true,
				'description': localize('window.nativeFullScreen', "Controls if native full-screen should be used on macOS. Disable this option to prevent macOS from creating a new space when going full-screen."),
				'scope': ConfigurationScope.APPLICATION,
				'included': isMacintosh
			},
			'window.clickThroughInactive': {
				'type': 'boolean',
				'default': true,
				'scope': ConfigurationScope.APPLICATION,
				'description': localize('window.clickThroughInactive', "If enabled, clicking on an inactive window will both activate the window and trigger the element under the mouse if it is clickable. If disabled, clicking anywhere on an inactive window will activate it only and a second click is required on the element."),
				'included': isMacintosh
			},
			'window.border': {
				'type': 'string',
				'default': 'default',
				'markdownDescription': (() => {
					let windowBorderDescription = localize('window.border.prefix', "Controls the border color of the window:");
					windowBorderDescription += '\n- ' + [
						localize('window.border.default', "{0}: respect color theme settings, fallback to Windows settings", '`default`'),
						localize('window.border.system', "{0}: respect Windows settings only", '`system`'),
						localize('window.border.off', "{0}: disable border colors", '`off`'),
						localize('window.border.color', "{0}: specific color in Hex, RGB, RGBA, HSL, HSLA format", '`<color>`'),
					].join('\n- ');
					windowBorderDescription += '\n\n' + localize('window.border.suffix', "Use {0} to set different colors for active and inactive windows. This setting is ignored when {1} is set to {2}.", '`#workbench.colorCustomizations#`', '`#window.titleBarStyle#`', '`native`');

					return windowBorderDescription;
				})(),
				'included': isWindows
			}
		}
	});

	// Telemetry
	registry.registerConfiguration({
		'id': 'telemetry',
		'order': 110,
		title: localize('telemetryConfigurationTitle', "Telemetry"),
		'type': 'object',
		'properties': {
			'telemetry.enableCrashReporter': {
				'type': 'boolean',
				'description': localize('telemetry.enableCrashReporting', "Enable crash reports to be collected. This helps us improve stability. \nThis option requires restart to take effect."),
				'default': true,
				'tags': ['usesOnlineServices', 'telemetry'],
				'markdownDeprecationMessage': localize('enableCrashReporterDeprecated', "If this setting is false, no telemetry will be sent regardless of the new setting's value. Deprecated due to being combined into the {0} setting.", `\`#${TELEMETRY_SETTING_ID}#\``),
			}
		}
	});

	// Keybinding
	registry.registerConfiguration({
		'id': 'keyboard',
		'order': 15,
		'type': 'object',
		'title': localize('keyboardConfigurationTitle', "Keyboard"),
		'properties': {
			'keyboard.touchbar.enabled': {
				'type': 'boolean',
				'default': true,
				'description': localize('touchbar.enabled', "Enables the macOS touchbar buttons on the keyboard if available."),
				'included': isMacintosh
			},
			'keyboard.touchbar.ignored': {
				'type': 'array',
				'items': {
					'type': 'string'
				},
				'default': [],
				'markdownDescription': localize('touchbar.ignored', 'A set of identifiers for entries in the touchbar that should not show up (for example `workbench.action.navigateBack`).'),
				'included': isMacintosh
			}
		}
	});

	// Security
	registry.registerConfiguration({
		...securityConfigurationNodeBase,
		'properties': {
			'security.promptForLocalFileProtocolHandling': {
				'type': 'boolean',
				'default': true,
				'markdownDescription': localize('security.promptForLocalFileProtocolHandling', 'If enabled, a dialog will ask for confirmation whenever a local file or workspace is about to open through a protocol handler.'),
				'scope': ConfigurationScope.APPLICATION
			}
			// Vacha: security.promptForRemoteFileProtocolHandling unregistered - no remote schemes can open, so its prompt path (electron-main app.ts) and the 'do not ask again' write (window.ts) are both unreachable.
		}
	});
})();

// JSON Schemas
(function registerJSONSchemas(): void {
	const argvDefinitionFileSchemaId = 'vscode://schemas/argv';
	const jsonRegistry = Registry.as<IJSONContributionRegistry>(JSONExtensions.JSONContribution);
	const schema: IJSONSchema = {
		id: argvDefinitionFileSchemaId,
		allowComments: true,
		allowTrailingCommas: true,
		description: 'VSCode static command line definition file',
		type: 'object',
		additionalProperties: false,
		properties: {
			locale: {
				type: 'string',
				description: localize('argv.locale', 'The display Language to use. Picking a different language requires the associated language pack to be installed.')
			},
			'disable-lcd-text': {
				type: 'boolean',
				description: localize('argv.disableLcdText', 'Disables LCD font antialiasing.')
			},
			'proxy-bypass-list': {
				type: 'string',
				description: localize('argv.proxyBypassList', 'Bypass any specified proxy for the given semi-colon-separated list of hosts. Example value "<local>;*.microsoft.com;*foo.com;1.2.3.4:5678", will use the proxy server for all hosts except for local addresses (localhost, 127.0.0.1 etc.), microsoft.com subdomains, hosts that contain the suffix foo.com and anything at 1.2.3.4:5678')
			},
			'disable-hardware-acceleration': {
				type: 'boolean',
				description: localize('argv.disableHardwareAcceleration', 'Disables hardware acceleration. ONLY change this option if you encounter graphic issues.')
			},
			'force-color-profile': {
				type: 'string',
				markdownDescription: localize('argv.forceColorProfile', 'Allows to override the color profile to use. If you experience colors appear badly, try to set this to `srgb` and restart.')
			},
			'enable-crash-reporter': {
				type: 'boolean',
				markdownDescription: localize('argv.enableCrashReporter', 'Allows to disable crash reporting, should restart the app if the value is changed.')
			},
			'crash-reporter-id': {
				type: 'string',
				markdownDescription: localize('argv.crashReporterId', 'Unique id used for correlating crash reports sent from this app instance.')
			},
			'enable-proposed-api': {
				type: 'array',
				description: localize('argv.enebleProposedApi', "Enable proposed APIs for a list of extension ids (such as \`vscode.git\`). Proposed APIs are unstable and subject to breaking without warning at any time. This should only be set for extension development and testing purposes."),
				items: {
					type: 'string'
				}
			},
			'log-level': {
				type: ['string', 'array'],
				description: localize('argv.logLevel', "Log level to use. Default is 'info'. Allowed values are 'error', 'warn', 'info', 'debug', 'trace', 'off'.")
			},
			'disable-chromium-sandbox': {
				type: 'boolean',
				description: localize('argv.disableChromiumSandbox', "Disables the Chromium sandbox. This is useful when running Vacha as elevated on Linux and running under Applocker on Windows.")
			},
			'use-inmemory-secretstorage': {
				type: 'boolean',
				description: localize('argv.useInMemorySecretStorage', "Ensures that an in-memory store will be used for secret storage instead of using the OS's credential store. This is often used when running Vacha extension tests or when you're experiencing difficulties with the credential store.")
			},
			'remote-debugging-port': {
				type: 'string',
				description: localize('argv.remoteDebuggingPort', "Specifies the port to use for remote debugging.")
			},
			'js-flags': {
				type: 'string',
				description: localize('argv.jsFlags', "Specifies V8 JavaScript engine flags to pass (e.g. \"--max-old-space-size=4096\"). These flags are applied to the main process, renderer and utility processes.")
			}
		}
	};
	if (isLinux) {
		schema.properties!['force-renderer-accessibility'] = {
			type: 'boolean',
			description: localize('argv.force-renderer-accessibility', 'Forces the renderer to be accessible. ONLY change this if you are using a screen reader on Linux. On other platforms the renderer will automatically be accessible. This flag is automatically set if you have editor.accessibilitySupport: on.'),
		};
		schema.properties!['password-store'] = {
			type: 'string',
			description: localize('argv.passwordStore', "Configures the backend used to store secrets on Linux. This argument is ignored on Windows & macOS.")
		};
	}
	if (isWindows) {
		schema.properties!['enable-rdp-display-tracking'] = {
			type: 'boolean',
			description: localize('argv.enableRDPDisplayTracking', "Ensures that maximized windows gets restored to correct display during RDP reconnection.")
		};
	}

	jsonRegistry.registerSchema(argvDefinitionFileSchemaId, schema);
})();
