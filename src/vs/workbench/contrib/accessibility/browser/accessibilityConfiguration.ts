/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ConfigurationScope, Extensions, IConfigurationNode, IConfigurationPropertySchema, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { workbenchConfigurationNodeBase, Extensions as WorkbenchExtensions, IConfigurationMigrationRegistry, ConfigurationKeyValuePairs, ConfigurationMigration } from '../../../common/configuration.js';
import { AccessibilitySignal } from '../../../../platform/accessibilitySignal/browser/accessibilitySignalService.js';
import { AccessibilityVoiceSettingId } from '../../speech/common/speechService.js';
import { isDefined } from '../../../../base/common/types.js';

export const accessibilityHelpIsShown = new RawContextKey<boolean>('accessibilityHelpIsShown', false, true);
export const accessibleViewIsShown = new RawContextKey<boolean>('accessibleViewIsShown', false, true);
export const accessibleViewSupportsNavigation = new RawContextKey<boolean>('accessibleViewSupportsNavigation', false, true);
export const accessibleViewVerbosityEnabled = new RawContextKey<boolean>('accessibleViewVerbosityEnabled', false, true);
export const accessibleViewGoToSymbolSupported = new RawContextKey<boolean>('accessibleViewGoToSymbolSupported', false, true);
export const accessibleViewOnLastLine = new RawContextKey<boolean>('accessibleViewOnLastLine', false, true);
export const accessibleViewCurrentProviderId = new RawContextKey<string>('accessibleViewCurrentProviderId', undefined, undefined);
export const accessibleViewInCodeBlock = new RawContextKey<boolean>('accessibleViewInCodeBlock', undefined, undefined);
export const accessibleViewContainsCodeBlocks = new RawContextKey<boolean>('accessibleViewContainsCodeBlocks', undefined, undefined);
export const accessibleViewHasUnassignedKeybindings = new RawContextKey<boolean>('accessibleViewHasUnassignedKeybindings', undefined, undefined);
export const accessibleViewHasAssignedKeybindings = new RawContextKey<boolean>('accessibleViewHasAssignedKeybindings', undefined, undefined);

/**
 * Miscellaneous settings tagged with accessibility and implemented in the accessibility contrib but
 * were better to live under workbench for discoverability.
 */
export const enum AccessibilityWorkbenchSettingId {
	DimUnfocusedEnabled = 'accessibility.dimUnfocused.enabled',
	DimUnfocusedOpacity = 'accessibility.dimUnfocused.opacity',
	HideAccessibleView = 'accessibility.hideAccessibleView',
	AccessibleViewCloseOnKeyPress = 'accessibility.accessibleView.closeOnKeyPress'
}

export const enum ViewDimUnfocusedOpacityProperties {
	Default = 0.75,
	Minimum = 0.2,
	Maximum = 1
}

// Vacha: verbosity ids for removed features are unregistered; enum members kept only where live
// code (in or out of closure) still compiles against them.
export const enum AccessibilityVerbositySettingId {
	DiffEditor = 'accessibility.verbosity.diffEditor',
	KeybindingsEditor = 'accessibility.verbosity.keybindingsEditor',
	Editor = 'accessibility.verbosity.editor',
	Hover = 'accessibility.verbosity.hover',
	Notification = 'accessibility.verbosity.notification',
	DiffEditorActive = 'accessibility.verbosity.diffEditorActive',
	SourceControl = 'accessibility.verbosity.sourceControl',
	Find = 'accessibility.verbosity.find',
	Survey = 'accessibility.verbosity.survey'
}

const baseVerbosityProperty: IConfigurationPropertySchema = {
	type: 'boolean',
	default: true,
	tags: ['accessibility']
};

export const accessibilityConfigurationNodeBase = Object.freeze<IConfigurationNode>({
	id: 'accessibility',
	title: localize('accessibilityConfigurationTitle', "Accessibility"),
	type: 'object'
});

export const soundFeatureBase: IConfigurationPropertySchema = {
	'type': 'string',
	'enum': ['auto', 'on', 'off'],
	'default': 'auto',
	'enumDescriptions': [
		localize('sound.enabled.auto', "Enable sound when a screen reader is attached."),
		localize('sound.enabled.on', "Enable sound."),
		localize('sound.enabled.off', "Disable sound.")
	],
	tags: ['accessibility'],
};

const signalFeatureBase: IConfigurationPropertySchema = {
	'type': 'object',
	'tags': ['accessibility'],
	additionalProperties: false,
	default: {
		sound: 'auto',
		announcement: 'auto'
	}
};

export const announcementFeatureBase: IConfigurationPropertySchema = {
	'type': 'string',
	'enum': ['auto', 'off'],
	'default': 'auto',
	'enumDescriptions': [
		localize('announcement.enabled.auto', "Enable announcement, will only play when in screen reader optimized mode."),
		localize('announcement.enabled.off', "Disable announcement.")
	],
	tags: ['accessibility'],
};

const defaultNoAnnouncement: IConfigurationPropertySchema = {
	'type': 'object',
	'tags': ['accessibility'],
	additionalProperties: false,
	'default': {
		'sound': 'auto',
	}
};

const configuration: IConfigurationNode = {
	...accessibilityConfigurationNodeBase,
	scope: ConfigurationScope.RESOURCE,
	properties: {
		[AccessibilityVerbositySettingId.DiffEditor]: {
			description: localize('verbosity.diffEditor.description', 'Provide information about how to navigate changes in the diff editor when it is focused.'),
			...baseVerbosityProperty
		},
		[AccessibilityVerbositySettingId.KeybindingsEditor]: {
			description: localize('verbosity.keybindingsEditor.description', 'Provide information about how to change a keybinding in the keybindings editor when a row is focused and how to navigate to the results table.'),
			...baseVerbosityProperty
		},
		[AccessibilityVerbositySettingId.Hover]: {
			description: localize('verbosity.hover', 'Provide information about how to open the hover in an Accessible View.'),
			...baseVerbosityProperty
		},
		[AccessibilityVerbositySettingId.Notification]: {
			description: localize('verbosity.notification', 'Provide information about how to open the notification in an Accessible View.'),
			...baseVerbosityProperty
		},
		[AccessibilityVerbositySettingId.DiffEditorActive]: {
			description: localize('verbosity.diffEditorActive', 'Indicate when a diff editor becomes the active editor.'),
			...baseVerbosityProperty
		},
		[AccessibilityWorkbenchSettingId.AccessibleViewCloseOnKeyPress]: {
			markdownDescription: localize('terminal.integrated.accessibleView.closeOnKeyPress', "On keypress, close the Accessible View and focus the element from which it was invoked."),
			type: 'boolean',
			default: true
		},
		[AccessibilityVerbositySettingId.Find]: {
			description: localize('verbosity.find', 'Provide information about how to access the find accessibility help menu when the find input is focused.'),
			...baseVerbosityProperty
		},
		// Vacha: accessibility.signals.* for removed features (markers/errors/warnings, breakpoints/debug, inlay hints, format, terminal, tasks, notebooks, chat/edits, voice) and the error/warning position delays are no longer registered - nothing can raise those events.
		'accessibility.signalOptions.volume': {
			'description': localize('accessibility.signalOptions.volume', "The volume of the sounds in percent (0-100)."),
			'type': 'number',
			'minimum': 0,
			'maximum': 100,
			'default': 70,
			'tags': ['accessibility']
		},
		'accessibility.signalOptions.debouncePositionChanges': {
			'description': localize('accessibility.signalOptions.debouncePositionChanges', "Whether or not position changes should be debounced"),
			'type': 'boolean',
			'default': false,
			'tags': ['accessibility']
		},
		'accessibility.signalOptions.experimental.delays.general': {
			'type': 'object',
			'description': 'Delays for all signals besides error and warning at position',
			'additionalProperties': false,
			'properties': {
				'announcement': {
					'description': localize('accessibility.signalOptions.delays.general.announcement', "The delay in milliseconds before an announcement is made."),
					'type': 'number',
					'minimum': 0,
					'default': 3000
				},
				'sound': {
					'description': localize('accessibility.signalOptions.delays.general.sound', "The delay in milliseconds before a sound is played."),
					'type': 'number',
					'minimum': 0,
					'default': 400
				}
			},
			'tags': ['accessibility']
		},
		'accessibility.signals.lineHasFoldedArea': {
			...signalFeatureBase,
			'description': localize('accessibility.signals.lineHasFoldedArea', "Plays a signal - sound (audio cue) and/or announcement (alert) - the active line has a folded area that can be unfolded."),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.lineHasFoldedArea.sound', "Plays a sound when the active line has a folded area that can be unfolded."),
					...soundFeatureBase,
					default: 'off'
				},
				'announcement': {
					'description': localize('accessibility.signals.lineHasFoldedArea.announcement', "Announces when the active line has a folded area that can be unfolded."),
					...announcementFeatureBase
				},
			}
		},
		'accessibility.signals.diffLineInserted': {
			...defaultNoAnnouncement,
			'description': localize('accessibility.signals.diffLineInserted', "Plays a sound / audio cue when the focus moves to an inserted line in Accessible Diff Viewer mode or to the next/previous change."),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.sound', "Plays a sound when the focus moves to an inserted line in Accessible Diff Viewer mode or to the next/previous change."),
					...soundFeatureBase
				}
			}
		},
		'accessibility.signals.diffLineModified': {
			...defaultNoAnnouncement,
			'description': localize('accessibility.signals.diffLineModified', "Plays a sound / audio cue when the focus moves to an modified line in Accessible Diff Viewer mode or to the next/previous change."),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.diffLineModified.sound', "Plays a sound when the focus moves to a modified line in Accessible Diff Viewer mode or to the next/previous change."),
					...soundFeatureBase
				}
			}
		},
		'accessibility.signals.diffLineDeleted': {
			...defaultNoAnnouncement,
			'description': localize('accessibility.signals.diffLineDeleted', "Plays a sound / audio cue when the focus moves to an deleted line in Accessible Diff Viewer mode or to the next/previous change."),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.diffLineDeleted.sound', "Plays a sound when the focus moves to an deleted line in Accessible Diff Viewer mode or to the next/previous change."),
					...soundFeatureBase
				}
			}
		},
		'accessibility.signals.progress': {
			...signalFeatureBase,
			'description': localize('accessibility.signals.progress', "Plays a signal - sound (audio cue) and/or announcement (alert) - on loop while progress is occurring."),
			'default': {
				'sound': 'auto',
				'announcement': 'off'
			},
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.progress.sound', "Plays a sound on loop while progress is occurring."),
					...soundFeatureBase
				},
				'announcement': {
					'description': localize('accessibility.signals.progress.announcement', "Alerts on loop while progress is occurring."),
					...announcementFeatureBase
				},
			},
		},
		'accessibility.signals.clear': {
			...signalFeatureBase,
			'description': localize('accessibility.signals.clear', "Plays a signal - sound (audio cue) and/or announcement (alert) - when a feature is cleared (for example, the terminal, Debug Console, or Output channel)."),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.clear.sound', "Plays a sound when a feature is cleared."),
					...soundFeatureBase
				},
				'announcement': {
					'description': localize('accessibility.signals.clear.announcement', "Announces when a feature is cleared."),
					...announcementFeatureBase
				},
			},
		},
		'accessibility.signals.save': {
			'type': 'object',
			'tags': ['accessibility'],
			additionalProperties: false,
			'markdownDescription': localize('accessibility.signals.save', "Plays a signal - sound (audio cue) and/or announcement (alert) - when a file is saved."),
			'properties': {
				'sound': {
					'description': localize('accessibility.signals.save.sound', "Plays a sound when a file is saved."),
					'type': 'string',
					'enum': ['userGesture', 'always', 'never'],
					'default': 'never',
					'enumDescriptions': [
						localize('accessibility.signals.save.sound.userGesture', "Plays the sound when a user explicitly saves a file."),
						localize('accessibility.signals.save.sound.always', "Plays the sound whenever a file is saved, including auto save."),
						localize('accessibility.signals.save.sound.never', "Never plays the sound.")
					],
				},
				'announcement': {
					'description': localize('accessibility.signals.save.announcement', "Announces when a file is saved."),
					'type': 'string',
					'enum': ['userGesture', 'always', 'never'],
					'default': 'never',
					'enumDescriptions': [
						localize('accessibility.signals.save.announcement.userGesture', "Announces when a user explicitly saves a file."),
						localize('accessibility.signals.save.announcement.always', "Announces whenever a file is saved, including auto save."),
						localize('accessibility.signals.save.announcement.never', "Never plays the announcement.")
					],
				},
			},
			default: {
				'sound': 'never',
				'announcement': 'never'
			}
		},
		'accessibility.underlineLinks': {
			'type': 'boolean',
			'description': localize('accessibility.underlineLinks', "Controls whether links should be underlined in the workbench."),
			'default': false,
		},
		'accessibility.windowTitleOptimized': {
			'type': 'boolean',
			'default': true,
			'markdownDescription': localize('accessibility.windowTitleOptimized', "Controls whether the {0} should be optimized for screen readers when in screen reader mode. When enabled, the window title will have {1} appended to the end.", '`#window.title#`', '`activeEditorState`')
		}
	}
};

export function registerAccessibilityConfiguration() {
	const registry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
	registry.registerConfiguration(configuration);

	registry.registerConfiguration({
		...workbenchConfigurationNodeBase,
		properties: {
			[AccessibilityWorkbenchSettingId.DimUnfocusedEnabled]: {
				description: localize('dimUnfocusedEnabled', 'Whether to dim unfocused editors and terminals, which makes it more clear where typed input will go to. This works with the majority of editors with the notable exceptions of those that utilize iframes like notebooks and extension webview editors.'),
				type: 'boolean',
				default: false,
				tags: ['accessibility'],
				scope: ConfigurationScope.APPLICATION,
			},
			[AccessibilityWorkbenchSettingId.DimUnfocusedOpacity]: {
				markdownDescription: localize('dimUnfocusedOpacity', 'The opacity fraction (0.2 to 1.0) to use for unfocused editors and terminals. This will only take effect when {0} is enabled.', `\`#${AccessibilityWorkbenchSettingId.DimUnfocusedEnabled}#\``),
				type: 'number',
				minimum: ViewDimUnfocusedOpacityProperties.Minimum,
				maximum: ViewDimUnfocusedOpacityProperties.Maximum,
				default: ViewDimUnfocusedOpacityProperties.Default,
				tags: ['accessibility'],
				scope: ConfigurationScope.APPLICATION,
			},
			[AccessibilityWorkbenchSettingId.HideAccessibleView]: {
				description: localize('accessibility.hideAccessibleView', "Controls whether the Accessible View is hidden."),
				type: 'boolean',
				default: false,
				tags: ['accessibility']
			}
		}
	});
}

export { AccessibilityVoiceSettingId };

export const SpeechTimeoutDefault = 0;

// Vacha: DynamicSpeechAccessibilityConfiguration removed - the accessibility.voice.* settings only ever registered behind a speech provider, which requires extensions.

Registry.as<IConfigurationMigrationRegistry>(WorkbenchExtensions.ConfigurationMigration)
	.registerConfigurationMigrations([{
		key: 'audioCues.volume',
		migrateFn: (value, accessor) => {
			return [
				['accessibility.signalOptions.volume', { value }],
				['audioCues.volume', { value: undefined }]
			];
		}
	}]);

Registry.as<IConfigurationMigrationRegistry>(WorkbenchExtensions.ConfigurationMigration)
	.registerConfigurationMigrations([{
		key: 'audioCues.debouncePositionChanges',
		migrateFn: (value) => {
			return [
				['accessibility.signalOptions.debouncePositionChanges', { value }],
				['audioCues.debouncePositionChanges', { value: undefined }]
			];
		}
	}]);

Registry.as<IConfigurationMigrationRegistry>(WorkbenchExtensions.ConfigurationMigration)
	.registerConfigurationMigrations([{
		key: 'accessibility.signalOptions',
		migrateFn: (value, accessor) => {
			const delayGeneral = getDelaysFromConfig(accessor, 'general');
			const delayError = getDelaysFromConfig(accessor, 'errorAtPosition');
			const delayWarning = getDelaysFromConfig(accessor, 'warningAtPosition');
			const volume = getVolumeFromConfig(accessor);
			const debouncePositionChanges = getDebouncePositionChangesFromConfig(accessor);
			const result: [key: string, { value: any }][] = [];
			if (!!volume) {
				result.push(['accessibility.signalOptions.volume', { value: volume }]);
			}
			if (!!delayGeneral) {
				result.push(['accessibility.signalOptions.experimental.delays.general', { value: delayGeneral }]);
			}
			if (!!delayError) {
				result.push(['accessibility.signalOptions.experimental.delays.errorAtPosition', { value: delayError }]);
			}
			if (!!delayWarning) {
				result.push(['accessibility.signalOptions.experimental.delays.warningAtPosition', { value: delayWarning }]);
			}
			if (!!debouncePositionChanges) {
				result.push(['accessibility.signalOptions.debouncePositionChanges', { value: debouncePositionChanges }]);
			}
			result.push(['accessibility.signalOptions', { value: undefined }]);
			return result;
		}
	}]);


Registry.as<IConfigurationMigrationRegistry>(WorkbenchExtensions.ConfigurationMigration)
	.registerConfigurationMigrations([{
		key: 'accessibility.signals.sounds.volume',
		migrateFn: (value) => {
			return [
				['accessibility.signalOptions.volume', { value }],
				['accessibility.signals.sounds.volume', { value: undefined }]
			];
		}
	}]);

Registry.as<IConfigurationMigrationRegistry>(WorkbenchExtensions.ConfigurationMigration)
	.registerConfigurationMigrations([{
		key: 'accessibility.signals.debouncePositionChanges',
		migrateFn: (value) => {
			return [
				['accessibility.signalOptions.debouncePositionChanges', { value }],
				['accessibility.signals.debouncePositionChanges', { value: undefined }]
			];
		}
	}]);

function getDelaysFromConfig(accessor: (key: string) => any, type: 'general' | 'errorAtPosition' | 'warningAtPosition'): { announcement: number; sound: number } | undefined {
	return accessor(`accessibility.signalOptions.experimental.delays.${type}`) || accessor('accessibility.signalOptions')?.['experimental.delays']?.[`${type}`] || accessor('accessibility.signalOptions')?.['delays']?.[`${type}`];
}

function getVolumeFromConfig(accessor: (key: string) => any): string | undefined {
	return accessor('accessibility.signalOptions.volume') || accessor('accessibility.signalOptions')?.volume || accessor('accessibility.signals.sounds.volume') || accessor('audioCues.volume');
}

function getDebouncePositionChangesFromConfig(accessor: (key: string) => any): number | undefined {
	return accessor('accessibility.signalOptions.debouncePositionChanges') || accessor('accessibility.signalOptions')?.debouncePositionChanges || accessor('accessibility.signals.debouncePositionChanges') || accessor('audioCues.debouncePositionChanges');
}

Registry.as<IConfigurationMigrationRegistry>(WorkbenchExtensions.ConfigurationMigration)
	.registerConfigurationMigrations([{
		key: AccessibilityVoiceSettingId.AutoSynthesize,
		migrateFn: (value: boolean) => {
			let newValue: string | undefined;
			if (value === true) {
				newValue = 'on';
			} else if (value === false) {
				newValue = 'off';
			} else {
				return [];
			}
			return [
				[AccessibilityVoiceSettingId.AutoSynthesize, { value: newValue }],
			];
		}
	}]);

Registry.as<IConfigurationMigrationRegistry>(WorkbenchExtensions.ConfigurationMigration)
	.registerConfigurationMigrations([{
		key: 'accessibility.signals.chatResponsePending',
		migrateFn: (value, accessor) => {
			return [
				['accessibility.signals.progress', { value }],
				['accessibility.signals.chatResponsePending', { value: undefined }],
			];
		}
	}]);

Registry.as<IConfigurationMigrationRegistry>(WorkbenchExtensions.ConfigurationMigration)
	.registerConfigurationMigrations(AccessibilitySignal.allAccessibilitySignals.map<ConfigurationMigration | undefined>(item => item.legacySoundSettingsKey ? ({
		key: item.legacySoundSettingsKey,
		migrateFn: (sound, accessor) => {
			const configurationKeyValuePairs: ConfigurationKeyValuePairs = [];
			const legacyAnnouncementSettingsKey = item.legacyAnnouncementSettingsKey;
			let announcement: string | undefined;
			if (legacyAnnouncementSettingsKey) {
				announcement = accessor(legacyAnnouncementSettingsKey) ?? undefined;
				if (announcement !== undefined && typeof announcement !== 'string') {
					announcement = announcement ? 'auto' : 'off';
				}
			}
			configurationKeyValuePairs.push([`${item.legacySoundSettingsKey}`, { value: undefined }]);
			configurationKeyValuePairs.push([`${item.settingsKey}`, { value: announcement !== undefined ? { announcement, sound } : { sound } }]);
			return configurationKeyValuePairs;
		}
	}) : undefined).filter(isDefined));

Registry.as<IConfigurationMigrationRegistry>(WorkbenchExtensions.ConfigurationMigration)
	.registerConfigurationMigrations(AccessibilitySignal.allAccessibilitySignals.filter(i => !!i.legacyAnnouncementSettingsKey && !!i.legacySoundSettingsKey).map(item => ({
		key: item.legacyAnnouncementSettingsKey!,
		migrateFn: (announcement, accessor) => {
			const configurationKeyValuePairs: ConfigurationKeyValuePairs = [];
			const sound = accessor(item.settingsKey)?.sound || accessor(item.legacySoundSettingsKey!);
			if (announcement !== undefined && typeof announcement !== 'string') {
				announcement = announcement ? 'auto' : 'off';
			}
			configurationKeyValuePairs.push([`${item.settingsKey}`, { value: announcement !== undefined ? { announcement, sound } : { sound } }]);
			configurationKeyValuePairs.push([`${item.legacyAnnouncementSettingsKey}`, { value: undefined }]);
			configurationKeyValuePairs.push([`${item.legacySoundSettingsKey}`, { value: undefined }]);
			return configurationKeyValuePairs;
		}
	})));
