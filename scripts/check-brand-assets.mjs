import { existsSync, readFileSync } from "node:fs";

const typographyPath = new URL("../app/styles/typography.css", import.meta.url);
const typography = readFileSync(typographyPath, "utf8");

const requiredFontFiles = [
    new URL("../public/fonts/canela/canela-medium.woff2", import.meta.url),
    new URL("../public/fonts/canela/canela-bold.woff2", import.meta.url),
];

function fail(message) {
    console.error(message);
    process.exit(1);
}

if (!typography.includes("Canela")) {
    fail("Brand typography must keep Canela as the marketing display font.");
}

const missingFonts = requiredFontFiles.filter((fontPath) => !existsSync(fontPath));

if (missingFonts.length > 0) {
    fail(
        [
            "Missing licensed Canela webfont assets:",
            ...missingFonts.map((fontPath) => `- ${fontPath.pathname}`),
            "Add licensed WOFF2 files before final screenshots or App Store submission.",
        ].join("\n"),
    );
}

console.log("Brand typography assets are ready.");
