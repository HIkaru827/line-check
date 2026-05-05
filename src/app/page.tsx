"use client";

import { ChangeEvent, useMemo, useState, useTransition } from "react";
import { anonymizeLineText, highlightText, type RiskMatch } from "@/lib/line";

type AnalysisType = "mood" | "intimacy" | "reply";

type AnalysisResult = {
  summary: string;
  sections: Array<{ title: string; body: string }>;
};

const SAMPLE_TEXT = `[LINE] 田中さんとのトーク履歴
保存日時：2026/05/05 20:40
2026/05/04(日)
19:10 自分 今日はありがとう！
19:12 田中さん こちらこそ〜 また渋谷でごはん行こ
19:14 自分 うれしい、来週どう？
19:16 田中さん これ送るね https://pay.paypay.ne.jp/example
19:18 自分 了解！連絡は test@example.com にもらえる？
19:20 田中さん 080-1234-5678 でも大丈夫`;

function HighlightedText({ text, risks }: { text: string; risks: RiskMatch[] }) {
  const segments = useMemo(() => highlightText(text, risks), [text, risks]);

  return (
    <div className="text-surface">
      {segments.map((segment) =>
        segment.kind ? (
          <mark key={segment.id} className={`highlight highlight-${segment.kind}`}>
            {segment.text}
          </mark>
        ) : (
          <span key={segment.id}>{segment.text}</span>
        ),
      )}
    </div>
  );
}

export default function Home() {
  const [rawText, setRawText] = useState(SAMPLE_TEXT);
  const [editedText, setEditedText] = useState("");
  const [analysisType, setAnalysisType] = useState<AnalysisType>("mood");
  const [confirmed, setConfirmed] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const anonymized = useMemo(() => anonymizeLineText(rawText), [rawText]);
  const outputText = editedText || anonymized.anonymizedText;

  const messageCount = anonymized.parsed.messages.filter((item) => item.type === "message").length;
  const participantCount = anonymized.parsed.participants.length;

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setError(null);
    setAnalysis(null);
    setConfirmed(false);

    if (!file.name.endsWith(".txt")) {
      setError(".txtファイルのみアップロードできます。");
      return;
    }

    if (file.size > 1024 * 1024 * 2) {
      setError("ファイルサイズは2MB以下にしてください。");
      return;
    }

    const text = await file.text();
    setRawText(text);
    setEditedText("");
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(outputText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function runAnalysis() {
    setError(null);
    setAnalysis(null);

    startTransition(async () => {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          anonymizedText: outputText,
          analysisType,
        }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setError(data.error || "分析に失敗しました。");
        return;
      }

      const data = (await response.json()) as AnalysisResult;
      setAnalysis(data);
    });
  }

  return (
    <main className="shell">
      <section className="hero">
        <span className="eyebrow">匿名化してからAIへ</span>
        <h1>そのLINE、AIに投げる前に安全化。</h1>
        <p>
          LINEのトーク履歴をブラウザ内で読み取り、名前・URL・連絡先などを置換したうえで、
          会話のムードや親密度を分析できるMVPです。匿名化前テキストは分析APIに送られません。
        </p>
        <div className="notice-strip">
          <span className="chip">元ファイルは保存しない前提</span>
          <span className="chip">匿名化はルールベース</span>
          <span className="chip">最終確認はユーザー自身</span>
        </div>
      </section>

      <div className="grid">
        <section className="panel">
          <h2>1. アップロード</h2>
          <p>.txtのLINE履歴を読み込みます。初期状態ではサンプル履歴を表示しています。</p>
          <div className="upload-box" style={{ marginTop: 16 }}>
            <div className="field-row">
              <input type="file" accept=".txt,text/plain" onChange={onFileChange} />
              <button className="button-secondary" onClick={() => setRawText(SAMPLE_TEXT)} type="button">
                サンプルに戻す
              </button>
            </div>
            <div className="meta">
              対応形式: LINEエクスポートの `.txt` / 上限 2MB / ブラウザ上で読み取り
            </div>
          </div>
          <div className="stats" style={{ marginTop: 18 }}>
            <div className="stat">
              メッセージ数
              <strong>{messageCount}</strong>
            </div>
            <div className="stat">
              参加者候補
              <strong>{participantCount}</strong>
            </div>
            <div className="stat">
              検出リスク
              <strong>{anonymized.risks.length}</strong>
            </div>
          </div>
        </section>

        <section className="panel">
          <h2>2. 危険情報ハイライト</h2>
          <p>URLや連絡先は赤、名前は黄、地名や学校名らしきものはオレンジで表示します。</p>
          <div style={{ marginTop: 16 }}>
            <HighlightedText text={rawText} risks={anonymized.risks} />
          </div>
        </section>

        <section className="panel">
          <h2>3. 匿名化前後の比較</h2>
          <p>右側はそのまま編集できます。AIに送られるのは右側のテキストだけです。</p>
          <div className="compare" style={{ marginTop: 16 }}>
            <div>
              <h3>匿名化前</h3>
              <HighlightedText text={rawText} risks={anonymized.risks} />
            </div>
            <div>
              <h3>匿名化後</h3>
              <textarea
                className="editor"
                value={outputText}
                onChange={(event) => setEditedText(event.target.value)}
              />
            </div>
          </div>
          <div className="field-row" style={{ marginTop: 16 }}>
            <button className="button" onClick={handleCopy} type="button">
              匿名化済みテキストをコピー
            </button>
            <span className="meta">{copied ? "コピーしました" : "ChatGPT等にそのまま貼りやすい形式です"}</span>
          </div>
        </section>

        <section className="panel">
          <h2>4. 検出された危険情報一覧</h2>
          <div className="risk-list" style={{ marginTop: 16 }}>
            {anonymized.risks.length === 0 ? (
              <div className="risk-item">
                <span>危険情報は検出されませんでした。</span>
              </div>
            ) : (
              anonymized.risks.map((risk) => (
                <div className="risk-item" key={risk.id}>
                  <div>
                    <div className="risk-kind">{risk.label}</div>
                    <code>{risk.value}</code>
                  </div>
                  <div className="meta">→ {risk.replacement}</div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <h2>5. AI分析</h2>
          <p>匿名化後のテキストのみAIに送信されます。消し漏れがないか確認してから実行してください。</p>
          <div className="analysis-box" style={{ marginTop: 16 }}>
            <div className="select">
              <label htmlFor="analysisType">分析タイプ</label>
              <select
                id="analysisType"
                value={analysisType}
                onChange={(event) => setAnalysisType(event.target.value as AnalysisType)}
              >
                <option value="mood">ムード分析</option>
                <option value="intimacy">親密度分析</option>
                <option value="reply">返信改善案</option>
              </select>
            </div>
            <label className="checkbox-row">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              匿名化漏れがないか確認しました
            </label>
            <div className="field-row">
              <button className="button" disabled={!confirmed || isPending} onClick={runAnalysis} type="button">
                {isPending ? "分析中..." : "分析を開始"}
              </button>
              <span className="meta">
                `OPENAI_API_KEY` が未設定でも、MVP確認用の簡易分析で動作します。
              </span>
            </div>
            {error ? <div className="meta" style={{ color: "var(--danger)" }}>{error}</div> : null}
          </div>

          {analysis ? (
            <div className="result">
              <div className="result-card">
                <h3>総評</h3>
                <p>{analysis.summary}</p>
              </div>
              {analysis.sections.map((section) => (
                <div className="result-card" key={section.title}>
                  <h3>{section.title}</h3>
                  <p>{section.body}</p>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="panel fineprint">
          <h2>注意書き・免責</h2>
          <div>本サービスは匿名化を補助するツールであり、完全な匿名化を保証するものではありません。</div>
          <div>匿名化前テキストをAIに送信しないでください。分析APIには匿名化後テキストのみを渡します。</div>
          <div>第三者の会話内容を扱う場合は、必要に応じて相手の同意を得てください。</div>
          <div>最終的な送信判断はユーザー自身で行ってください。</div>
        </section>
      </div>
    </main>
  );
}
