import {Component, EmbedChild, EmbedContext, TFile} from "obsidian";
import PlantumlPlugin from "./main";

export class PumlEmbed extends Component implements EmbedChild {
    plugin: PlantumlPlugin;
    ctx: EmbedContext;
    file: TFile;

    constructor(plugin: PlantumlPlugin, file: TFile, ctx: EmbedContext) {
        super();
        this.plugin = plugin;
        this.file = file;
        this.ctx = ctx;
    }

    async loadFile() {
        const data = await this.plugin.app.vault.cachedRead(this.file);
        const caption = this.getCaption();
        await this.plugin.debouncedProcessor.default(data, this.ctx.containerEl, caption
            ? {sourcePath: this.file.path, caption}
            : {sourcePath: this.file.path});
    }

    /**
     * the display text of the embed (`![[diagram.puml|caption]]`), which Obsidian puts into `alt`.
     * without display text `alt` holds the link itself, and sizes like `|400` or `|400x300` aren't captions either.
     */
    getCaption(): string | null {
        const el = this.ctx.containerEl;
        const alt = el.getAttribute("alt")?.trim();
        if (!alt || /^\d+(x\d+)?$/.test(alt)) return null;
        if ([el.getAttribute("src"), this.file.path, this.file.name, this.file.basename].includes(alt)) return null;
        return alt;
    }

}
