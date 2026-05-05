import fs from 'fs/promises';

async function fetchJson(url) {
  const res = await fetch(url);
  return res.json();
}

async function main() {
  const places = new Set();
  const excludeList = new Set([
    "中央", "港", "南", "北", "西", "東", "緑", "森", "旭", "栄", "泉", "中",
    "さくら", "平和", "白鳥", "富士", "三芳", "美浜", "い", "な", "の", "か", "し", "て"
  ]); // 一般名詞と被りやすい地名を除外

  // ひらがな・カタカナのみで構成されているか判定
  const isKanaOnly = (str) => /^[\u3040-\u309F\u30A0-\u30FF]+$/.test(str);

  const addPlace = (name) => {
    if (!name || name.trim().length === 0) return;
    // 1文字のひらがな/カタカナは完全除外
    if (name.length === 1 && isKanaOnly(name)) return;
    if (!excludeList.has(name)) {
      places.add(name);
    }
  };

  console.log('1. Geolonia APIから市区町村を取得中...');
  const addrData = await fetchJson('https://raw.githubusercontent.com/geolonia/japanese-addresses/master/api/ja.json');
  for (const [pref, cities] of Object.entries(addrData)) {
    addPlace(pref.replace(/[都道府]$/, '').replace(/県$/, ''));
    for (const city of cities) {
      let name = city;
      // 郡などの場合は除外（例: 余市郡余市町 -> 余市町）
      const match = city.match(/(?:.+?[郡])?(.+)/);
      if (match) name = match[1];
      
      const raw = name.replace(/(市|区|町|村)$/, '');
      addPlace(raw);
    }
  }
  
  console.log('2. HeartRails APIから路線と駅名を取得中...');
  try {
    const prefData = await fetchJson('http://express.heartrails.com/api/json?method=getPrefectures');
    const prefectures = prefData.response.prefecture;
    
    // API負荷を考慮し直列で取得
    for (const pref of prefectures) {
      const lineData = await fetchJson(`http://express.heartrails.com/api/json?method=getLines&prefecture=${encodeURIComponent(pref)}`);
      const lines = lineData.response.line;
      for (const line of lines) {
        const stationData = await fetchJson(`http://express.heartrails.com/api/json?method=getStations&line=${encodeURIComponent(line)}`);
        const stations = stationData.response.station;
        for (const station of stations) {
          addPlace(station.name);
        }
      }
      process.stdout.write('.'); // 進捗表示
    }
    console.log('\n駅名の取得完了。');
  } catch (e) {
    console.warn('\n駅名の取得中にエラーが発生しました（一部のみの取得になります）。', e.message);
  }

  const strictPlaces = [];
  const safePlaces = [];

  for (const p of places) {
    if (p.length <= 2 || isKanaOnly(p)) {
      strictPlaces.push(p);
    } else {
      safePlaces.push(p);
    }
  }

  strictPlaces.sort((a, b) => b.length - a.length);
  safePlaces.sort((a, b) => b.length - a.length);
  
  await fs.mkdir('src/lib', { recursive: true });
  await fs.writeFile('src/lib/places.json', JSON.stringify({ strict: strictPlaces, safe: safePlaces }, null, 2));
  
  console.log(`合計 ${places.size} 件 (安全: ${safePlaces.length}, 要文脈: ${strictPlaces.length}) の地名データを src/lib/places.json に保存しました！`);
}

main().catch(console.error);
