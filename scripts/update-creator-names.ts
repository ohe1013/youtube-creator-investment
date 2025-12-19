import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * [Dynamic Mapping Dictionary]
 * 이 목록에 없는 크리에이터는 실행 후 리스트업됩니다.
 */
const nameMapping: Record<string, string> = {
  PewDiePie: "퓨디파이",
  MrBeast: "미스터비스트",
  "T-Series": "티시리즈",
  Cocomelon: "코코멜론",
  "SET India": "셋 인디아",
  "Kids Diana Show": "키즈 다이아나 쇼",
  "Like Nastya": "라이크 나스탸",
  "Vlad and Niki": "블라드와 니키",
  "Justin Bieber": "저스틴 비버",
  "Dude Perfect": "듀드 퍼펙트",
  Marshmello: "마시멜로",
  EminemMusic: "에미넴",
  "Ed Sheeran": "에드 시런",
  "Ariana Grande": "아리아나 그란데",
  "Taylor Swift": "테일러 스위프트",
  "Billie Eilish": "빌리 아일리시",
  "Bad Bunny": "배드 버니",
  "J Balvin": "제이 발빈",
  Drake: "드레이크",
  "The Weeknd": "위켄드",
  Markiplier: "마키플라이어",
  Jacksepticeye: "잭셉틱아이",
  DanTDM: "단티디엠",
  Dream: "드림",
  Technoblade: "테크노블레이드",
  Sia: "시아",
  "Katy Perry": "케이티 페리",
  "Pinkfong Baby Shark - Kids' Songs & Stories": "핑크퐁",
  "ChuChu TV Nursery Rhymes & Kids Songs": "츄츄티비",
  "Canal KondZilla": "콘드질라",
  BLACKPINK: "블랙핑크",
  BTS: "방탄소년단",
  "HYBE LABELS": "하이브",
  SMTOWN: "SM엔터테인먼트",
  "JYP Entertainment": "JYP엔터테인먼트",
};

async function main() {
  console.log("🔍 [1/3] Fetching creators from your database...");

  // DB에서 데이터를 긁어오는(fetch) 부분입니다.
  const creators = await prisma.creator.findMany();
  console.log(`📊 Found ${creators.length} creators in your Creator table.`);

  let updatedCount = 0;
  let missingTranslations: string[] = [];

  console.log("⚙️  [2/3] Applying translation logic...");

  for (const creator of creators) {
    // 매핑 로직: Dictionary에서 찾거나, 특정 규칙을 적용할 수 있습니다.
    const koName = nameMapping[creator.name];

    if (koName) {
      await prisma.creator.update({
        where: { id: creator.id },
        data: { nameKo: koName },
      });
      console.log(`✅ [UPDATED] ${creator.name} -> ${koName}`);
      updatedCount++;
    } else {
      missingTranslations.push(creator.name);
    }
  }

  // 3. 결과 보고
  console.log("\n✨ [3/3] Migration Summary");
  console.log("============================");
  console.log(`🚀 Successfully updated: ${updatedCount} creators`);

  if (missingTranslations.length > 0) {
    console.log(`⚠️  Missing translations (${missingTranslations.length}):`);
    console.log(missingTranslations.join(", "));
    console.log(
      "\n💡 위 목록은 스크립트 코드의 'nameMapping'에 추가하시면 됩니다."
    );
  }
}

main()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
