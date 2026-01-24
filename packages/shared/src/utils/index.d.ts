export declare function sleep(ms: number): Promise<void>;
export declare function randomDelay(minMs: number, maxMs: number): Promise<void>;
export declare function formatPhone(phone: string): string;
export declare function parseTemplateVariables(content: string): string[];
export declare function applyTemplate(template: string, variables: Record<string, string>): string;
export declare function generateId(): string;
export declare function chunk<T>(array: T[], size: number): T[][];
export declare function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K>;
export declare function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K>;
//# sourceMappingURL=index.d.ts.map