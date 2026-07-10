import Link from "next/link";

type LegalPageProps = {
  title: string;
  summary: string;
  effectiveDate: string;
  children: React.ReactNode;
};

export function LegalPage({
  title,
  summary,
  effectiveDate,
  children,
}: LegalPageProps) {
  return (
    <main className="creatorx-screen bg-background px-4 py-10 text-foreground">
      <article className="mx-auto max-w-3xl rounded-2xl border border-border-exchange bg-card p-6 shadow-sm md:p-10">
        <Link
          href="/"
          className="mb-8 inline-flex text-sm font-semibold text-primary hover:underline"
        >
          ← 크리에이터X로 돌아가기
        </Link>
        <header className="mb-8 border-b border-border-exchange pb-6">
          <h1 className="text-3xl font-black tracking-tight">{title}</h1>
          <p className="mt-3 leading-7 text-muted">{summary}</p>
          <p className="mt-3 text-sm text-muted">시행일: {effectiveDate}</p>
        </header>
        <div className="space-y-8 leading-7">{children}</div>
      </article>
    </main>
  );
}

export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 text-xl font-bold">{title}</h2>
      <div className="space-y-3 text-sm text-muted md:text-base">{children}</div>
    </section>
  );
}
