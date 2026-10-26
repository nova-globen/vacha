/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { renderMarkdown } from '../../../../base/browser/markdownRenderer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { ActiveEditorContext, ResourceContextKey } from '../../../common/contextkeys.js';
import { DEFAULT_EDITOR_ASSOCIATION, EditorExtensions, EditorInputCapabilities, IEditorFactoryRegistry, IEditorOpenContext, IEditorSerializer } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';

const MARKDOWN_PREVIEW_EDITOR_ID = 'workbench.editor.tondMarkdownPreview';
const MARKDOWN_PREVIEW_INPUT_ID = 'workbench.input.tondMarkdownPreview';

class MarkdownPreviewInput extends EditorInput {

	static readonly ID = MARKDOWN_PREVIEW_INPUT_ID;

	constructor(readonly resource: URI) {
		super();
	}

	override get typeId(): string {
		return MarkdownPreviewInput.ID;
	}

	override get editorId(): string {
		return MARKDOWN_PREVIEW_EDITOR_ID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly;
	}

	override getName(): string {
		return basename(this.resource);
	}

	override matches(other: EditorInput): boolean {
		return other instanceof MarkdownPreviewInput && other.resource.toString() === this.resource.toString();
	}
}

class MarkdownPreviewEditorPane extends EditorPane {

	static readonly ID = MARKDOWN_PREVIEW_EDITOR_ID;

	private contentElement: HTMLElement | undefined;
	private readonly inputDisposables = this._register(new DisposableStore());
	private readonly contentDisposables = this._register(new DisposableStore());

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IFileService private readonly fileService: IFileService,
		@IOpenerService private readonly openerService: IOpenerService,
	) {
		super(MarkdownPreviewEditorPane.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		// full width so the scrollbar sits at the right edge; the workbench
		// disables selection by default, the preview is text to copy from
		this.contentElement = dom.append(parent, dom.$('.tond-md-preview-content'));
		this.contentElement.tabIndex = 0;
		this.contentElement.style.width = '100%';
		this.contentElement.style.height = '100%';
		this.contentElement.style.boxSizing = 'border-box';
		this.contentElement.style.overflow = 'auto';
		this.contentElement.style.outline = 'none';
		this.contentElement.style.padding = '0 26px 40px 26px';
		this.contentElement.style.lineHeight = '1.6';
		this.contentElement.style.userSelect = 'text';
		this.contentElement.style.webkitUserSelect = 'text';
		this.contentElement.style.cursor = 'text';
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);

		if (!(input instanceof MarkdownPreviewInput) || !this.contentElement) {
			return;
		}

		this.inputDisposables.clear();
		await this.render(input.resource, token);

		// live-update the preview when the file changes on disk
		const watcher = this.inputDisposables.add(this.fileService.createWatcher(input.resource, { recursive: false, excludes: [] }));
		this.inputDisposables.add(watcher.onDidChange(() => this.render(input.resource, CancellationToken.None)));
	}

	private async render(resource: URI, token: CancellationToken): Promise<void> {
		const content = await this.fileService.readFile(resource);
		if (token.isCancellationRequested || !this.contentElement) {
			return;
		}

		this.contentDisposables.clear();
		dom.clearNode(this.contentElement);
		const rendered = renderMarkdown(new MarkdownString(content.value.toString(), { supportHtml: false, isTrusted: false }), {
			actionHandler: (linkContent: string) => { this.openerService.open(linkContent, { allowCommands: false }); }
		});
		this.contentDisposables.add(rendered);
		this.contentElement.appendChild(rendered.element);
	}

	override focus(): void {
		super.focus();
		this.contentElement?.focus();
	}

	override clearInput(): void {
		this.inputDisposables.clear();
		this.contentDisposables.clear();
		if (this.contentElement) {
			dom.clearNode(this.contentElement);
		}
		super.clearInput();
	}

	override layout(dimension: dom.Dimension): void {
		// sized by CSS
	}
}

class MarkdownPreviewInputSerializer implements IEditorSerializer {

	canSerialize(editorInput: EditorInput): boolean {
		return editorInput instanceof MarkdownPreviewInput;
	}

	serialize(editorInput: EditorInput): string | undefined {
		if (!(editorInput instanceof MarkdownPreviewInput)) {
			return undefined;
		}
		return JSON.stringify({ resource: editorInput.resource.toString() });
	}

	deserialize(instantiationService: IInstantiationService, serializedEditorInput: string): EditorInput | undefined {
		try {
			const { resource } = JSON.parse(serializedEditorInput);
			return instantiationService.createInstance(MarkdownPreviewInput, URI.parse(resource));
		} catch {
			return undefined;
		}
	}
}

/**
 * The group a breadcrumbs action was clicked in (its arg is the group id),
 * or the active group when run from a keybinding.
 */
function resolveGroup(accessor: ServicesAccessor, groupId: unknown): IEditorGroup {
	const editorGroupsService = accessor.get(IEditorGroupsService);
	return (typeof groupId === 'number' ? editorGroupsService.getGroup(groupId) : undefined) ?? editorGroupsService.activeGroup;
}

const previewActive = ActiveEditorContext.isEqualTo(MARKDOWN_PREVIEW_EDITOR_ID);
const markdownSourceActive = ContextKeyExpr.and(
	previewActive.negate(),
	ResourceContextKey.LangId.isEqualTo('markdown'),
	ResourceContextKey.Scheme.notEqualsTo(Schemas.untitled)
);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'tond.markdown.showPreview',
			title: localize2('mdShowPreview', "Preview"),
			icon: Codicon.openPreview,
			precondition: markdownSourceActive,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyV,
				when: ContextKeyExpr.and(EditorContextKeys.focus, EditorContextKeys.languageId.isEqualTo('markdown')),
				weight: KeybindingWeight.WorkbenchContrib
			},
			menu: { id: MenuId.BreadcrumbsTrailing, group: 'navigation', when: markdownSourceActive }
		});
	}

	run(accessor: ServicesAccessor, groupId?: unknown): void {
		const group = resolveGroup(accessor, groupId);
		const editor = group.activeEditor;
		if (!editor?.resource || editor instanceof MarkdownPreviewInput) {
			return;
		}
		accessor.get(IEditorService).replaceEditors([{
			editor,
			replacement: accessor.get(IInstantiationService).createInstance(MarkdownPreviewInput, editor.resource)
		}], group);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'tond.markdown.showSource',
			title: localize2('mdShowSource', "Edit"),
			icon: Codicon.edit,
			precondition: previewActive,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyV,
				when: previewActive,
				weight: KeybindingWeight.WorkbenchContrib
			},
			menu: { id: MenuId.BreadcrumbsTrailing, group: 'navigation', when: previewActive }
		});
	}

	run(accessor: ServicesAccessor, groupId?: unknown): void {
		const group = resolveGroup(accessor, groupId);
		const editor = group.activeEditor;
		if (!(editor instanceof MarkdownPreviewInput)) {
			return;
		}
		accessor.get(IEditorService).replaceEditors([{
			editor,
			replacement: { resource: editor.resource, options: { override: DEFAULT_EDITOR_ASSOCIATION.id } }
		}], group);
	}
});

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		MarkdownPreviewEditorPane,
		MarkdownPreviewEditorPane.ID,
		localize('markdownPreview', "Markdown Preview")
	),
	[new SyncDescriptor(MarkdownPreviewInput)]
);

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(MarkdownPreviewInput.ID, MarkdownPreviewInputSerializer);
