import { afterEach, describe, expect, it, vi } from "vitest";
import { emitTelemetryEvent, serializeError } from "../../lib/telemetry";

describe("telemetry", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("emits structured JSON with sanitized properties", () => {
        const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

        emitTelemetryEvent("queue_failure", {
            shop: "unoir.myshopify.com",
            count: 2,
            at: new Date("2026-05-01T12:00:00.000Z"),
            skipped: undefined,
        });

        expect(consoleLog).toHaveBeenCalledTimes(1);
        const payload = JSON.parse(String(consoleLog.mock.calls[0][0]));
        expect(payload).toMatchObject({
            event: "queue_failure",
            level: "info",
            shop: "unoir.myshopify.com",
            count: 2,
            at: "2026-05-01T12:00:00.000Z",
        });
        expect(payload).not.toHaveProperty("skipped");
        expect(payload.timestamp).toEqual(expect.any(String));
    });

    it("routes warning and error events to the matching console channel", () => {
        const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

        emitTelemetryEvent("worker_offline", {}, "warn");
        emitTelemetryEvent("publish_failed", {}, "error");

        expect(consoleWarn).toHaveBeenCalledTimes(1);
        expect(consoleError).toHaveBeenCalledTimes(1);
    });

    it("does not let properties override canonical telemetry fields", () => {
        const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

        emitTelemetryEvent("actual_event", {
            event: "spoofed_event",
            level: "error",
            timestamp: "yesterday",
        });

        const payload = JSON.parse(String(consoleLog.mock.calls[0][0]));
        expect(payload.event).toBe("actual_event");
        expect(payload.level).toBe("info");
        expect(payload.timestamp).not.toBe("yesterday");
    });

    it("does not throw when a telemetry payload cannot be serialized", () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const circular: Record<string, unknown> = {};
        circular.self = circular;

        expect(() =>
            emitTelemetryEvent("bad_payload", circular as Parameters<typeof emitTelemetryEvent>[1]),
        ).not.toThrow();

        const payload = JSON.parse(String(consoleError.mock.calls[0][0]));
        expect(payload).toMatchObject({
            event: "telemetry_emit_failed",
            level: "error",
            originalEvent: "bad_payload",
        });
    });

    it("serializes operational error details without stack traces", () => {
        const error = new Error("remove.bg failed");
        Object.assign(error, { status: 429, retryable: true });

        expect(serializeError(error)).toEqual({
            errorName: "Error",
            errorMessage: "remove.bg failed",
            errorStatus: 429,
            retryable: true,
        });
    });
});