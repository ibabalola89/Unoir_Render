export type TelemetryLevel = "info" | "warn" | "error";

export type TelemetryValue =
    | string
    | number
    | boolean
    | null
    | undefined
    | Date
    | TelemetryValue[]
    | { [key: string]: TelemetryValue };

export type TelemetryProperties = Record<string, TelemetryValue>;

export function emitTelemetryEvent(
    event: string,
    properties: TelemetryProperties = {},
    level: TelemetryLevel = "info",
): void {
    try {
        const payload = {
            ...sanitizeProperties(properties),
            event,
            level,
            timestamp: new Date().toISOString(),
        };
        const line = JSON.stringify(payload);
        if (level === "error") {
            console.error(line);
            return;
        }
        if (level === "warn") {
            console.warn(line);
            return;
        }
        console.log(line);
    } catch (err) {
        console.error(JSON.stringify({
            event: "telemetry_emit_failed",
            level: "error",
            timestamp: new Date().toISOString(),
            originalEvent: event,
            errorMessage: err instanceof Error ? err.message : String(err),
        }));
    }
}

export function serializeError(error: unknown): TelemetryProperties {
    if (error instanceof Error) {
        const details: TelemetryProperties = {
            errorName: error.name,
            errorMessage: error.message,
        };
        const withStatus = error as { status?: unknown; retryable?: unknown };
        if (typeof withStatus.status === "number") details.errorStatus = withStatus.status;
        if (typeof withStatus.retryable === "boolean") details.retryable = withStatus.retryable;
        return details;
    }
    return { errorMessage: String(error) };
}

function sanitizeProperties(properties: TelemetryProperties): TelemetryProperties {
    return Object.fromEntries(
        Object.entries(properties)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [key, sanitizeValue(value)]),
    );
}

function sanitizeValue(value: TelemetryValue): TelemetryValue {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(sanitizeValue);
    if (value && typeof value === "object") {
        return sanitizeProperties(value as TelemetryProperties);
    }
    return value;
}