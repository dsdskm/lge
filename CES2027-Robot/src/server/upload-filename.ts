export function normalizeUploadName(name: string): string {
    if ([...name].some((character) => character.charCodeAt(0) > 255)) return name.normalize("NFC");
    const decoded = Buffer.from(name, "latin1").toString("utf8");
    return Buffer.from(decoded, "utf8").toString("latin1") === name ? decoded.normalize("NFC") : name.normalize("NFC");
}