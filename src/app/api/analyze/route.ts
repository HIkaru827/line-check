import { NextRequest, NextResponse } from "next/server";

type AnalysisType = "mood" | "intimacy" | "reply";

function heuristicAnalyze(text: string, analysisType: AnalysisType) {
  const positive = (text.match(/ありがとう|嬉しい|たのしい|楽しい|笑|！|また/g) || []).length;
  const distant = (text.match(/了解|うん|へえ|忙しい|また今度|ごめん/g) || []).length;
  const questions = (text.match(/？|\?/g) || []).length;

  const warmth = positive - distant;
  const mood =
    warmth >= 3 ? "前向きで柔らかい雰囲気" : warmth >= 0 ? "フラット寄りで無難な雰囲気" : "やや距離感のある雰囲気";
  const intimacy =
    questions >= 4 || positive >= 4 ? "会話を続けたい意志が見えやすい" : "必要連絡寄りで、感情は少し読み取りにくい";

  if (analysisType === "reply") {
    return {
      summary: "匿名化済みテキストをもとに、返しやすく圧をかけすぎない返信方針を出しました。",
      sections: [
        {
          title: "今の空気感",
          body: mood,
        },
        {
          title: "返信のコツ",
          body:
            warmth >= 0
              ? "短く終わらせず、相手が答えやすい一問を添えると自然です。予定確認か感想共有の形が相性よさそうです。"
              : "重めの追撃は避けて、相手が負担なく返せる軽い確認一つに絞るのが安全です。",
        },
        {
          title: "返信例",
          body:
            warmth >= 0
              ? "「それ聞けてよかった。ちなみにこの前の話、今はどうなってる？」のように、共感＋軽い質問が使いやすいです。"
              : "「了解、落ち着いたらまた教えてね」くらいの余白ある返しが無難です。",
        },
      ],
    };
  }

  return {
    summary:
      analysisType === "mood"
        ? "匿名化済みテキストから、会話全体のムードをざっくり読み取りました。"
        : "匿名化済みテキストから、会話の親密度サインをざっくり拾いました。",
    sections: [
      {
        title: analysisType === "mood" ? "ムード" : "親密度",
        body: analysisType === "mood" ? mood : intimacy,
      },
      {
        title: "観測ポイント",
        body: `ポジティブ表現 ${positive}件 / 温度が低めに見える表現 ${distant}件 / 質問 ${questions}件`,
      },
      {
        title: "注意点",
        body: "これはルールベースの簡易分析です。相手の文量、返信速度、前後の文脈までは完全には読めません。",
      },
    ],
  };
}

async function openAiAnalyze(text: string, analysisType: AnalysisType) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return heuristicAnalyze(text, analysisType);
  }

  const promptMap: Record<AnalysisType, string> = {
    mood: "会話のムードを日本語で分析してください。総評、ムード、関係性、注意点を簡潔に返してください。",
    intimacy: "会話の親密度を日本語で分析してください。総評、親密度、脈あり/なしの断定を避けた注意点を返してください。",
    reply: "会話をふまえて、自然で重すぎない返信改善案を日本語で返してください。総評、空気感、返信のコツ、返信例を返してください。",
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "あなたはLINE会話の相談員です。匿名化済みテキストのみを受け取り、断定を避けつつ実用的に分析します。",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `${promptMap[analysisType]}\n\n匿名化済みテキスト:\n${text}`,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    return heuristicAnalyze(text, analysisType);
  }

  const data = (await response.json()) as {
    output_text?: string;
  };

  return {
    summary: "匿名化済みテキストのみをAI分析しました。",
    sections: [
      {
        title: "分析結果",
        body: data.output_text || "結果を取得できなかったため、簡易結果に切り替えてください。",
      },
    ],
  };
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    anonymizedText?: string;
    analysisType?: AnalysisType;
  };

  const anonymizedText = body.anonymizedText?.trim();
  const analysisType = body.analysisType || "mood";

  if (!anonymizedText) {
    return NextResponse.json({ error: "匿名化済みテキストがありません。" }, { status: 400 });
  }

  const result = await openAiAnalyze(anonymizedText, analysisType);
  return NextResponse.json(result);
}

