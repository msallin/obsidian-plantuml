import {describe, expect, it, vi} from "vitest";
import {TFile} from "obsidian";
import {PumlEmbed} from "../src/embed";
import {extractCaption} from "../src/functions";
import {DebouncedProcessors} from "../src/processors/debouncedProcessors";
import {DEFAULT_SETTINGS, PlantUMLSettings, PlantUMLSettingsTab} from "../src/settings";
import {createPlugin} from "./helpers";

const SOURCE = "@startuml\ncaption Figure 1: Login\nA -> B\n@enduml";
const CONTEXT = {sourcePath: "Notes/example.md"};

function render(settings: Partial<PlantUMLSettings> = {}) {
    const plugin = createPlugin({settings: {debounce: 1, ...settings}});
    const svg = vi.fn(async (_source: string, el: HTMLElement) => {
        el.empty();
        el.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg"><text>A</text></svg>';
    });
    plugin.serverProcessor = {svg} as never;
    return {plugin, svg, processors: new DebouncedProcessors(plugin), el: document.createElement("div")};
}

describe("extractCaption", () => {
    it("removes the caption line and returns its text", () => {
        expect(extractCaption(SOURCE)).toEqual({source: "@startuml\n\nA -> B\n@enduml", caption: "Figure 1: Login"});
        expect(extractCaption("Caption: Overview \nA -> B").caption).toBe("Overview");
    });

    it("uses the last caption like PlantUML and turns \\n into line breaks", () => {
        const {source, caption} = extractCaption("caption first\nA -> B\n  caption second\\nline");
        expect(caption).toBe("second\nline");
        expect(source).not.toContain("caption");
    });

    it("leaves diagrams without a caption and caption style selectors alone", () => {
        const styled = "<style>\ncaption {\n  FontSize 10\n}\n</style>\ncaptionist -> B";
        expect(extractCaption(styled)).toEqual({source: styled, caption: null});
    });
});

describe("captions below diagrams", () => {
    it("keeps the caption inside the image unless enabled", async () => {
        const {processors, svg, el} = render();

        await processors.svg(SOURCE, el, CONTEXT);

        expect(svg).toHaveBeenCalledWith(expect.stringContaining("caption Figure 1: Login"), el, CONTEXT);
        expect(el.querySelector(".puml-caption")).toBeNull();
        expect(el.hasAttribute("role")).toBe(false);
    });

    it("renders the caption below the diagram instead of inside the image", async () => {
        const {processors, svg, el} = render({captionBelowDiagram: true});

        await processors.svg(SOURCE, el, CONTEXT);

        expect(svg.mock.calls[0][0]).not.toContain("caption");
        expect(el.querySelector(":scope > svg")).not.toBeNull();
        expect(el.lastElementChild?.className).toBe("puml-caption");
        expect(el.lastElementChild?.textContent).toBe("Figure 1: Login");
        expect(el.hasClass("puml-figure")).toBe(true);
        expect(el.getAttribute("role")).toBe("figure");
        expect(el.getAttribute("aria-label")).toBe("Figure 1: Login");
    });

    it("prefers the caption of the embedding note, also when not enabled", async () => {
        for (const captionBelowDiagram of [false, true]) {
            const {processors, el} = render({captionBelowDiagram});

            await processors.svg(SOURCE, el, {...CONTEXT, caption: "From the note"});

            expect(el.querySelectorAll(".puml-caption")).toHaveLength(1);
            expect(el.querySelector(".puml-caption")?.textContent).toBe("From the note");
        }
    });

    it("updates the caption when the diagram is rerendered", async () => {
        vi.useFakeTimers();
        try {
            const {processors, el} = render({captionBelowDiagram: true});

            await processors.svg(SOURCE, el, CONTEXT);
            void processors.svg(SOURCE.replace("Login", "Logout"), el, CONTEXT);
            await vi.advanceTimersByTimeAsync(1000);
            expect(el.querySelectorAll(".puml-caption")).toHaveLength(1);
            expect(el.querySelector(".puml-caption")?.textContent).toBe("Figure 1: Logout");

            void processors.svg("@startuml\nA -> B\n@enduml", el, CONTEXT);
            await vi.advanceTimersByTimeAsync(1000);
            expect(el.querySelector(".puml-caption")).toBeNull();
            expect(el.hasClass("puml-figure")).toBe(false);
            expect(el.hasAttribute("role")).toBe(false);
            expect(el.hasAttribute("aria-label")).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it("keeps the caption when the diagram could not be rendered", async () => {
        const {plugin, processors, el} = render({captionBelowDiagram: true});
        plugin.serverProcessor = {svg: vi.fn(async () => {
            throw new Error("boom");
        })} as never;
        vi.spyOn(console, "error").mockImplementation(() => undefined);

        await processors.svg(SOURCE, el, CONTEXT);

        expect(el.querySelector(".puml-error")).not.toBeNull();
        expect(el.querySelector(".puml-caption")?.textContent).toBe("Figure 1: Login");
    });

    it("is a toggle that is off by default", () => {
        expect(DEFAULT_SETTINGS.captionBelowDiagram).toBe(false);
        const definitions = new PlantUMLSettingsTab(createPlugin()).getSettingDefinitions();
        const setting = definitions.find(definition => definition.name === "Captions below diagrams");
        expect(setting?.control).toMatchObject({type: "toggle", key: "captionBelowDiagram", defaultValue: false});
    });
});

describe("embed captions", () => {
    async function loadEmbed(attributes: Record<string, string>) {
        const file = new TFile("Diagrams/flow.puml");
        const containerEl = document.createElement("span");
        for (const [name, value] of Object.entries(attributes)) containerEl.setAttribute(name, value);
        const defaultProcessor = vi.fn(async () => undefined);
        const plugin = createPlugin();
        plugin.app.vault.cachedRead = vi.fn(async () => SOURCE);
        plugin.debouncedProcessor = {default: defaultProcessor} as never;

        await new PumlEmbed(plugin, file, {app: plugin.app, containerEl}).loadFile();
        return defaultProcessor.mock.calls[0][2] as {sourcePath: string, caption?: string};
    }

    it("passes the display text of the embed as caption", async () => {
        expect(await loadEmbed({src: "flow.puml", alt: " The login flow "}))
            .toEqual({sourcePath: "Diagrams/flow.puml", caption: "The login flow"});
    });

    it("ignores embeds without display text and sizes", async () => {
        for (const alt of ["", "flow.puml", "flow", "Diagrams/flow.puml", "400", "400x300"]) {
            expect(await loadEmbed({src: "flow.puml", alt})).toEqual({sourcePath: "Diagrams/flow.puml"});
        }
        expect(await loadEmbed({src: "Diagrams/flow"})).toEqual({sourcePath: "Diagrams/flow.puml"});
    });
});
