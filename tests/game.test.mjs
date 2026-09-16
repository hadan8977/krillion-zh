import test from "node:test";
import assert from "node:assert/strict";
import { QUESTIONS, PACKS } from "../src/questions.js";
import { ROUND_MS, TIERS, normalize, judge, suggest, selectQuestions, localDate, newDive, beginRound, submitAnswer, restoreDive, totalScore, shareText } from "../src/game.js";

const q = (id) => QUESTIONS.find((question) => question.id === id);
test("everyday answer sets have unambiguous aliases and one designated gem", () => {
  assert.equal(QUESTIONS.length, 48);
  assert.equal(q("pocket-items"), undefined);
  assert.equal(new Set(QUESTIONS.map((question) => question.id)).size, QUESTIONS.length);
  assert.equal(new Set(QUESTIONS.map((question) => question.prompt)).size, QUESTIONS.length);
  for (const question of QUESTIONS) {
    assert.ok(question.prompt && question.scope, question.id);
    assert.equal(question.answers.filter((answer) => answer.tier === "krillion").length, 1, question.id);
    const seen = new Map();
    for (const answer of question.answers) {
      assert.ok(TIERS[answer.tier]);
      for (const alias of [answer.label, ...answer.aliases]) {
        const key = normalize(alias);
        assert.ok(key, `${question.id}: empty alias`);
        assert.ok(!seen.has(key) || seen.get(key) === answer.label, `${question.id}: ambiguous alias ${alias}`);
        seen.set(key, answer.label);
        assert.equal(judge(question, alias)?.answer, answer.label);
      }
    }
  }
});

test("Chinese scripts, compatibility forms, and everyday aliases share the same score", () => {
  for (const [id, label, aliases] of [
    ["bathroom-items", "吹风机", ["吹風機", "电吹风"]],
    ["kitchen-tools", "压泥器", ["馬鈴薯壓泥器", "土豆压泥器"]],
    ["schoolbag", "U盘", ["Ｕ盤", "优盘", " usb 闪存盘 "]],
    ["noodle-dishes", "番茄鸡蛋面", ["西紅柿雞蛋面", "番茄蛋面"]],
    ["schoolbag", "橡皮", ["橡皮擦", " “橡皮” "]],
    ["sour-foods", "猕猴桃", ["獼猴桃", "奇异果"]],
    ["cleaning-tools", "扫把", ["扫帚", "掃帚"]],
    ["wheeled-transport", "自行车", ["腳踏車", "单车"]],
    ["unplugged-toys", "溜溜球", ["悠悠球"]],
    ["bread-spreads", "咖椰酱", ["咖央醬", "加椰酱", "ＫＡＹＡ"]],
    ["waiting-activities", "刷视频", ["刷短视频", "看視頻", "刷抖音"]],
    ["winter-warmth", "暖宝宝", ["暖貼", "发热贴"]],
  ]) {
    const expected = judge(q(id), label);
    assert.equal(expected?.answer, label, `${id}: ${label}`);
    for (const alias of aliases) assert.deepEqual(judge(q(id), alias), expected, `${id}: ${alias}`);
  }
});

test("each everyday prompt accepts familiar and unexpected examples within its stated scope", () => {
  const examples = [
    ["drink-from", ["杯子", "碗", "奶瓶", "椰子壳"], "漏勺"],
    ["breakfast", ["鸡蛋", "云吞", "糍粑"], "洗洁精"],
    ["noodle-dishes", ["牛肉面", "螺蛳粉", "锅盖面"], "米饭"],
    ["sour-foods", ["柠檬", "酸味糖果", "罗望子"], "小苏打"],
    ["seasonings", ["盐", "番茄酱", "南乳"], "洗衣粉"],
    ["hot-drinks", ["水", "热巧克力", "姜汁可乐"], "排骨汤"],
    ["kitchen-tools", ["筷子", "餐叉", "压蒜器", "樱桃去核器"], "冰箱"],
    ["bathroom-items", ["牙刷", "冲牙器", "挤牙膏器"], "红绿灯"],
    ["cleaning-tools", ["拖把", "旧牙刷", "除尘胶"], "望远镜"],
    ["handles", ["门", "马克杯", "皮搋子"], "硬币"],
    ["plug-in", ["手机", "电动牙刷", "电烙铁"], "普通铅笔"],
    ["bedside", ["手机", "眼镜盒", "枕头喷雾"], "消防车"],
    ["unplugged-toys", ["积木", "悠悠球", "剑玉"], "电子游戏机"],
    ["zippers", ["裤子", "枕套", "琴包"], "玻璃杯"],
    ["rain-gear", ["雨伞", "背包雨罩", "防水袜"], "菜刀"],
    ["schoolbag", ["课本", "口风琴", "姓名贴"], "洗衣机"],
    ["headwear", ["帽子", "头灯", "防蚊头网"], "袜子"],
    ["wallet-items", ["钞票", "创可贴", "吉他拨片"], "台灯"],
    ["wheeled-transport", ["自行车", "轮椅", "行李牵引车"], "帆船"],
    ["park-things", ["树", "跷跷板", "昆虫旅馆"], "火星探测器"],
    ["picnic-items", ["三明治", "垃圾袋", "桌布夹"], "信号灯"],
    ["street-fixtures", ["路灯", "自行车架", "盲人过街提示器"], "羽绒服"],
    ["sports-no-ball", ["跑步", "跳绳", "抖空竹"], "足球"],
    ["beach-things", ["贝壳", "海玻璃", "沙钱"], "洗碗机"],
    ["potato-foods", ["炸薯条", "马铃薯泥", "洋芋搅团"], "南瓜饼"],
    ["round-foods", ["鸡蛋", "汤圆", "蛋挞", "糯米糍"], "面条"],
    ["cold-treats", ["冰激凌", "冰酸奶", "冻梨"], "热豆浆"],
    ["crunchy-foods", ["薯片", "荸荠", "炸米纸"], "豆腐脑"],
    ["filled-foods", ["饺子", "云吞", "炸藕盒"], "清水面条"],
    ["bread-spreads", ["黄油", "番茄酱", "咖央酱"], "洗手液"],
    ["home-lights", ["台灯", "手机", "缝纫机灯"], "普通镜子"],
    ["foldable-things", ["纸张", "折叠键盘", "乐谱架"], "石头"],
    ["beeping-things", ["微波炉", "烟雾报警器", "电煮蛋器"], "普通铅笔"],
    ["hangable-things", ["衣服", "花盆", "晴天娃娃"], "水"],
    ["soft-things", ["枕头", "捏捏乐", "记忆棉"], "砖头"],
    ["lidded-things", ["锅", "口红", "砚台"], "筷子"],
    ["gifts", ["鲜花", "电影票", "星空灯"], "垃圾"],
    ["winter-warmth", ["围巾", "暖宝宝", "暖脚袋"], "冰块"],
    ["paired-things", ["筷子", "耳塞", "蛙鞋"], "剪刀"],
    ["clothing-patterns", ["条纹", "格纹", "千鸟格", "回形针"], "蓝色"],
    ["waiting-activities", ["玩手机", "听音乐", "刷朋友圈", "系鞋带", "画速写"], "洗衣机"],
    ["cooling-things", ["风扇", "蒲扇", "冰滚轮"], "电热毯"],
    ["flying-things", ["飞机", "蝙蝠", "枫树翅果"], "鸵鸟"],
    ["group-games", ["斗地主", "躲猫猫", "UNO", "绘画接龙"], "单人纸牌"],
    ["amusement-park", ["云霄飞车", "摩天轮", "身高尺"], "洗碗机"],
    ["water-animals", ["鱼", "企鹅", "水獭", "水黾"], "仙人掌"],
    ["neighborhood-shops", ["便利店", "配钥匙店", "修拉链店"], "红绿灯"],
    ["wind-moved", ["旗帜", "柳絮", "风向袋", "风动招牌"], "地基"],
  ];
  assert.deepEqual(examples.map(([id]) => id).sort(), QUESTIONS.map(({id}) => id).sort());
  for (const [id, accepted, rejected] of examples) {
    for (const value of accepted) assert.ok(judge(q(id), value), `${id}: missing ${value}`);
    assert.equal(judge(q(id), rejected), null, `${id}: out of scope ${rejected}`);
  }
});

test("guesses must be complete single answers; a typo is never automatically awarded points", () => {
  for (const value of ["", " ", "手机钥匙", "手机、钥匙", "手机/钥匙", "我选手机", "<script>手机</script>"]) assert.equal(judge(q("schoolbag"), value), null);
  assert.equal(judge(q("bathroom-items"), "挤牙膏机"), null);
  assert.equal(suggest(q("bathroom-items"), "挤牙膏机"), "挤牙膏器");
  assert.equal(suggest(q("schoolbag"), "手几"), null);
});

test("daily dates use Beijing midnight, independently of the host timezone", () => {
  assert.equal(localDate(new Date("2026-09-15T15:59:59Z")), "2026-09-15");
  assert.equal(localDate(new Date("2026-09-15T16:00:00Z")), "2026-09-16");
});

test("daily selection is stable, varied, and each pack has seven distinct questions", () => {
  assert.deepEqual(selectQuestions("2026-09-15"), selectQuestions("2026-09-15"));
  assert.notDeepEqual(selectQuestions("2026-09-15"), selectQuestions("2026-09-16"));
  for (const pack of Object.keys(PACKS)) {
    const chosen = selectQuestions("example", pack);
    assert.equal(chosen.length, 7);
    assert.equal(new Set(chosen.map((a) => a.id)).size, 7);
    if (pack !== "all") assert.ok(chosen.every((a) => PACKS[pack].categories.includes(a.category)));
  }
  assert.equal(new Set(selectQuestions("2026-09-15").map((a) => a.category)).size, 4);
});

test("an invalid guess preserves the original deadline and permits another attempt", () => {
  const dive = beginRound(newDive(), 1000);
  const rejected = submitAnswer(dive, "not an answer", 2000);
  assert.equal(rejected.error, "unknown");
  assert.equal(rejected.dive, dive);
  const answer = q(dive.ids[0]).answers[0];
  const accepted = submitAnswer(rejected.dive, answer.label, 3000);
  assert.equal(accepted.dive.results.length, 1);
  assert.equal(accepted.result.score, TIERS[answer.tier].score);
  assert.equal(submitAnswer(accepted.dive, answer.label, 4000).error, "inactive");
});

test("the exact deadline rejects even a valid answer and survives a reload", () => {
  const dive = beginRound(newDive(), 1000);
  const restored = restoreDive(JSON.parse(JSON.stringify(dive)));
  assert.equal(restored.deadline, 1000 + ROUND_MS);
  const answer = q(dive.ids[0]).answers[0].label;
  assert.equal(submitAnswer(restored, answer, dive.deadline - 1).result.timedOut, false);
  assert.equal(submitAnswer(restored, answer, dive.deadline).result.timedOut, true);
  assert.equal(submitAnswer(restored, answer, dive.deadline + 100000).result.score, 0);
});

test("seven gems finish at exactly 700 points; the next timer begins only on Continue", () => {
  let dive = newDive();
  for (let i = 0; i < 7; i++) {
    dive = beginRound(dive, 1000 * i);
    const gem = q(dive.ids[i]).answers.find((a) => a.tier === "krillion");
    dive = submitAnswer(dive, gem.label, 1000 * i + 1).dive;
    assert.equal(dive.phase, "feedback");
    assert.equal(dive.deadline, null);
  }
  dive = beginRound(dive);
  assert.equal(dive.phase, "done");
  assert.equal(totalScore(dive), 700);
  assert.equal(beginRound(dive), dive);
  assert.deepEqual(restoreDive(dive), dive);
  const shared = shareText(dive);
  assert.ok(shared.includes("7000 米"));
  assert.ok(dive.results.every((r) => !shared.includes(r.answer)));
});

test("damaged or incompatible saves never become playable sessions", () => {
  const dive = beginRound(newDive(), 1000);
  for (const value of [null, {}, { ...dive, version: "old" }, { ...dive, pack: "culture" }, { ...dive, pack: "nature" }, { ...dive, ids: ["fake"] }, { ...dive, deadline: null }, { ...dive, phase: "done" }, { ...dive, results: [null] }]) assert.equal(restoreDive(value), null);
  const answered = submitAnswer(dive, q(dive.ids[0]).answers[0].label, 2000).dive;
  const tampered = structuredClone(answered);
  tampered.results[0].score = 700;
  assert.equal(restoreDive(tampered), null);
});
