/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Schemas } from '../../../../base/common/network.js';
import { ByteSize, IFileService } from '../../../../platform/files/common/files.js';
import { basename, extname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ActiveEditorContext, ResourceContextKey } from '../../../common/contextkeys.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { DEFAULT_EDITOR_ASSOCIATION, EditorInputCapabilities, IEditorOpenContext, IEditorSerializer, EditorExtensions, IEditorFactoryRegistry } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Dimension } from '../../../../base/browser/dom.js';

const IMAGE_PREVIEW_EDITOR_ID = 'workbench.editor.imagePreview';
const IMAGE_PREVIEW_INPUT_ID = 'workbench.input.imagePreview';

const MIME_BY_EXTENSION: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.jfif': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.bmp': 'image/bmp',
	'.ico': 'image/x-icon',
	'.avif': 'image/avif',
	'.svg': 'image/svg+xml',
};

const SVG_EXTENSION = '.svg';

class ImagePreviewInput extends EditorInput {

	static readonly ID = IMAGE_PREVIEW_INPUT_ID;

	constructor(readonly resource: URI) {
		super();
	}

	override get typeId(): string {
		return ImagePreviewInput.ID;
	}

	override get editorId(): string {
		return IMAGE_PREVIEW_EDITOR_ID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly;
	}

	override getName(): string {
		return basename(this.resource);
	}

	override matches(other: EditorInput): boolean {
		return other instanceof ImagePreviewInput && other.resource.toString() === this.resource.toString();
	}
}

class ImagePreviewEditorPane extends EditorPane {

	static readonly ID = IMAGE_PREVIEW_EDITOR_ID;

	private container: HTMLElement | undefined;
	private imageElement: HTMLImageElement | undefined;
	private captionElement: HTMLElement | undefined;
	private objectUrl: string | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IFileService private readonly fileService: IFileService,
	) {
		super(ImagePreviewEditorPane.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.container = dom.append(parent, dom.$('.vacha-image-preview'));
		this.container.style.display = 'flex';
		this.container.style.flexDirection = 'column';
		this.container.style.width = '100%';
		this.container.style.height = '100%';

		const imageHost = dom.append(this.container, dom.$('.vacha-image-preview-host'));
		imageHost.style.flex = '1';
		imageHost.style.display = 'flex';
		imageHost.style.alignItems = 'center';
		imageHost.style.justifyContent = 'center';
		imageHost.style.overflow = 'hidden';
		imageHost.style.minHeight = '0';
		// checkerboard to make transparency visible in both themes
		imageHost.style.backgroundImage = 'conic-gradient(rgba(128, 128, 128, .18) 25%, transparent 0 50%, rgba(128, 128, 128, .18) 0 75%, transparent 0)';
		imageHost.style.backgroundSize = '24px 24px';

		this.imageElement = dom.append(imageHost, dom.$('img')) as HTMLImageElement;
		this.imageElement.style.maxWidth = '100%';
		this.imageElement.style.maxHeight = '100%';
		this.imageElement.style.objectFit = 'contain';
		this.imageElement.draggable = false;

		this.captionElement = dom.append(this.container, dom.$('.vacha-image-preview-caption'));
		this.captionElement.style.flex = '0 0 auto';
		this.captionElement.style.padding = '4px 12px';
		this.captionElement.style.textAlign = 'center';
		this.captionElement.style.opacity = '0.8';
		this.captionElement.style.fontSize = '12px';
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);

		if (!(input instanceof ImagePreviewInput) || !this.imageElement || !this.captionElement) {
			return;
		}

		const content = await this.fileService.readFile(input.resource);
		if (token.isCancellationRequested) {
			return;
		}

		this.releaseObjectUrl();
		const mime = MIME_BY_EXTENSION[extname(input.resource).toLowerCase()] ?? 'application/octet-stream';
		this.objectUrl = URL.createObjectURL(new Blob([content.value.buffer as BufferSource], { type: mime }));

		const image = this.imageElement;
		const caption = this.captionElement;
		image.onload = () => {
			caption.textContent = localize('imageCaption', "{0}×{1}   {2}", image.naturalWidth, image.naturalHeight, ByteSize.formatSize(content.size));
		};
		image.src = this.objectUrl;
	}

	override clearInput(): void {
		this.releaseObjectUrl();
		if (this.imageElement) {
			this.imageElement.src = '';
		}
		if (this.captionElement) {
			this.captionElement.textContent = '';
		}
		super.clearInput();
	}

	override layout(dimension: Dimension): void {
		// the flex layout adapts on its own
	}

	override focus(): void {
		super.focus();
		this.container?.focus();
	}

	override dispose(): void {
		this.releaseObjectUrl();
		super.dispose();
	}

	private releaseObjectUrl(): void {
		if (this.objectUrl) {
			URL.revokeObjectURL(this.objectUrl);
			this.objectUrl = undefined;
		}
	}
}

class ImagePreviewInputSerializer implements IEditorSerializer {

	canSerialize(editorInput: EditorInput): boolean {
		return editorInput instanceof ImagePreviewInput;
	}

	serialize(editorInput: EditorInput): string | undefined {
		if (!(editorInput instanceof ImagePreviewInput)) {
			return undefined;
		}
		return JSON.stringify({ resource: editorInput.resource.toString() });
	}

	deserialize(instantiationService: IInstantiationService, serializedEditorInput: string): EditorInput | undefined {
		try {
			const { resource } = JSON.parse(serializedEditorInput);
			return instantiationService.createInstance(ImagePreviewInput, URI.parse(resource));
		} catch {
			return undefined;
		}
	}
}

class ImagePreviewContribution implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.vachaImagePreview';

	constructor(
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		// SVG is source code: it opens in the text editor and previews on demand
		// through the path-bar toggle below
		editorResolverService.registerEditor(
			`{${Object.keys(MIME_BY_EXTENSION).filter(ext => ext !== SVG_EXTENSION).map(ext => `**/*${ext}`).join(',')}}`,
			{
				id: IMAGE_PREVIEW_EDITOR_ID,
				label: localize('imagePreview', "Image Preview"),
				priority: RegisteredEditorPriority.builtin
			},
			{},
			{
				createEditorInput: ({ resource }) => ({ editor: instantiationService.createInstance(ImagePreviewInput, resource) })
			}
		);
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

const svgPreviewActive = ContextKeyExpr.and(ActiveEditorContext.isEqualTo(IMAGE_PREVIEW_EDITOR_ID), ResourceContextKey.Extension.isEqualTo(SVG_EXTENSION));
const svgSourceActive = ContextKeyExpr.and(
	ActiveEditorContext.isEqualTo(IMAGE_PREVIEW_EDITOR_ID).negate(),
	ResourceContextKey.Extension.isEqualTo(SVG_EXTENSION),
	ResourceContextKey.Scheme.notEqualsTo(Schemas.untitled)
);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'tond.svg.showPreview',
			title: localize2('svgShowPreview', "Preview"),
			icon: Codicon.openPreview,
			precondition: svgSourceActive,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyV,
				when: ContextKeyExpr.and(EditorContextKeys.focus, svgSourceActive),
				weight: KeybindingWeight.WorkbenchContrib
			},
			menu: { id: MenuId.BreadcrumbsTrailing, group: 'navigation', when: svgSourceActive }
		});
	}

	run(accessor: ServicesAccessor, groupId?: unknown): void {
		const group = resolveGroup(accessor, groupId);
		const editor = group.activeEditor;
		if (!editor?.resource || editor instanceof ImagePreviewInput) {
			return;
		}
		accessor.get(IEditorService).replaceEditors([{
			editor,
			replacement: accessor.get(IInstantiationService).createInstance(ImagePreviewInput, editor.resource)
		}], group);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'tond.svg.showSource',
			title: localize2('svgShowSource', "Edit"),
			icon: Codicon.edit,
			precondition: svgPreviewActive,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyV,
				when: svgPreviewActive,
				weight: KeybindingWeight.WorkbenchContrib
			},
			menu: { id: MenuId.BreadcrumbsTrailing, group: 'navigation', when: svgPreviewActive }
		});
	}

	run(accessor: ServicesAccessor, groupId?: unknown): void {
		const group = resolveGroup(accessor, groupId);
		const editor = group.activeEditor;
		if (!(editor instanceof ImagePreviewInput)) {
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
		ImagePreviewEditorPane,
		ImagePreviewEditorPane.ID,
		localize('imagePreview', "Image Preview")
	),
	[new SyncDescriptor(ImagePreviewInput)]
);

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(ImagePreviewInput.ID, ImagePreviewInputSerializer);

registerWorkbenchContribution2(ImagePreviewContribution.ID, ImagePreviewContribution, WorkbenchPhase.BlockRestore);
