const KST = 'Asia/Seoul';

const hm = new Intl.DateTimeFormat('ko-KR', { timeZone: KST, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const hms = new Intl.DateTimeFormat('ko-KR', {
  timeZone: KST, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

const join = (f: Intl.DateTimeFormat, d: Date) =>
  f.formatToParts(d).filter((p) => p.type !== 'literal').map((p) => p.value).join(':');

/** 한국 시각 "14:29" */
export const hhmm = (iso: string) => join(hm, new Date(iso));
/** 한국 시각 "14:29:05" */
export const hhmmss = (d: Date) => join(hms, d);

const mdhm = new Intl.DateTimeFormat('ko-KR', {
  timeZone: KST, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
/** 한국 시각 "11월 12일 14:29" */
export const mdhhmm = (iso: string) => {
  const p = Object.fromEntries(mdhm.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.month}월 ${p.day}일 ${p.hour}:${p.minute}`;
};
