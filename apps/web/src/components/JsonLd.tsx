/** 서버 컴포넌트. `<` 를 이스케이프해 값 안의 `</script>` 가 태그를 닫지 못하게 한다. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
