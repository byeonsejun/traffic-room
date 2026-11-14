/** Date → ISO 문자열(쿼리 매개변수). */
export const iso = (d: Date) => d.toISOString();
/** DB 드라이버마다 timestamptz 를 Date 나 문자열로 주므로 Date 로 맞춘다. */
export const toDate = (v: unknown) => (v instanceof Date ? v : new Date(v as string));
export const toIso = (v: unknown) => toDate(v).toISOString();
