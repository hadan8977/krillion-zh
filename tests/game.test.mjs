import test from "node:test";
import assert from "node:assert/strict";
import { QUESTIONS, PACKS } from "../src/questions.js";
import { ROUND_MS, TIERS, normalize, judge, suggest, selectQuestions, localDate, newDive, beginRound, submitAnswer, restoreDive, totalScore, shareText } from "../src/game.js";

const q = (id) => QUESTIONS.find((question) => question.id === id);
test("sixty everyday categories have unambiguous aliases and one designated gem", () => {
  assert.equal(QUESTIONS.length, 60);
  for (const retired of ["pocket-items", "unplugged-toys", "crunchy-foods", "gifts", "bedside", "hangable-things", "waiting-activities"]) assert.equal(q(retired), undefined);
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

test("Chinese scripts, compatibility forms, regional names, and merged aliases share scores", () => {
  for (const [id, label, aliases] of [
    ["home-appliances", "吹风机", ["吹風機", "电吹风"]],
    ["kitchen-tools", "压泥器", ["馬鈴薯壓泥器", "土豆压泥器"]],
    ["stationery", "U盘", ["Ｕ盤", "优盘", " usb 闪存盘"]],
    ["noodle-dishes", "番茄鸡蛋面", ["西紅柿雞蛋麵", "番茄蛋面"]],
    ["stationery", "橡皮", ["橡皮擦", " “橡皮” "]],
    ["fruits", "猕猴桃", ["獼猴桃", "奇異果"]],
    ["cleaning-tools", "扫把", ["扫帚", "笤帚"]],
    ["wheeled-transport", "自行车", ["腳踏車", "单车"]],
    ["instruments", "键盘口琴", ["口風琴"]],
    ["sauces", "咖椰酱", ["咖央醬", "加椰酱", "ＫＡＹＡ"]],
    ["dog-breeds", "贵宾犬", ["贵宾", "泰迪"]],
    ["porridges", "及第粥", ["状元及第粥", "状元粥"]],
    ["card-games", "锄大地", ["鋤大Ｄ", "大老二"]],
    ["nuts-seeds", "碧根果", ["长寿果", "美洲山核桃"]],
    ["edible-mushrooms", "香菇", ["冬菇"]],
    ["card-games", "升级", ["拖拉机", "双升", "八十分"]],
    ["grains", "小米", ["谷子", "粟"]],
    ["spices", "桂皮", ["肉桂", "肉桂粉"]],
  ]) {
    const expected = judge(q(id), label);
    assert.equal(expected?.answer, label, `${id}: ${label}`);
    for (const alias of aliases) assert.deepEqual(judge(q(id), alias), expected, `${id}: ${alias}`);
  }
});

test("every category accepts everyday examples and rejects nearby out-of-scope answers", () => {
  const examples = [
    ["drink-from", ["玻璃杯", "马克杯", "保温壶", "军用水壶"], ["试管", "椰子壳"]],
    ["porridges", ["白粥", "皮蛋瘦肉粥", "鸭肉粥"], ["小米", "排骨汤"]],
    ["noodle-dishes", ["牛肉面", "螺蛳粉", "干炒牛河", "锅盖面"], ["炒饭", "炒"]],
    ["fruits", ["苹果", "车厘子", "指橙"], ["苹果汁", "开心果"]],
    ["spices", ["生姜", "香叶", "葫芦巴"], ["盐", "辣椒酱"]],
    ["teas", ["铁观音", "菊花茶", "荞麦茶"], ["拿铁", "珍珠奶茶"]],
    ["kitchen-tools", ["菜刀", "压蒜器", "樱桃去核器"], ["冰箱", "饭碗"]],
    ["bathroom-items", ["牙刷", "冲牙器", "皂网"], ["马桶", "洁厕灵"]],
    ["cleaning-tools", ["拖把", "白醋", "除尘胶"], ["手帕", "床单"]],
    ["hand-tools", ["螺丝刀", "内六角扳手", "截链器"], ["电钻", "螺丝"]],
    ["home-appliances", ["电饭煲", "电动牙刷", "咖啡机"], ["手机", "插头"]],
    ["bedding", ["枕头", "被套", "床褥防螨套"], ["床头柜", "手机"]],
    ["instruments", ["钢琴", "木琴", "特雷门琴"], ["音响", "小星星"]],
    ["bags", ["书包", "托特包", "车把包"], ["纸盒", "钥匙"]],
    ["rain-gear", ["雨伞", "背包雨罩", "自行车坐垫雨套"], ["纸巾", "手机"]],
    ["stationery", ["钢笔", "橡皮擦", "U盘", "橡皮屑清理器"], ["课本", "打印机"]],
    ["hats", ["棒球帽", "摩托车头盔", "猎鹿帽"], ["发夹", "头灯"]],
    ["jewelry", ["戒指", "鲨鱼夹", "臂钏"], ["红宝石", "帽子"]],
    ["wheeled-transport", ["自行车", "轮椅", "轨道自行车"], ["帆船", "飞机"]],
    ["trees", ["柳树", "柿子树", "鹅掌楸"], ["竹子", "旅人蕉"]],
    ["camping-gear", ["帐篷", "储水袋", "吊床底被"], ["三明治", "身份证"]],
    ["street-fixtures", ["路灯", "盲人过街提示器", "管线标志桩"], ["公交车", "便利店"]],
    ["sports-no-ball", ["跑步", "跳绳", "蹼泳"], ["足球", "篮球"]],
    ["marine-animals", ["鲨鱼", "儒艮", "羽毛星"], ["金鱼", "海带"]],
    ["potato-foods", ["炸薯条", "醋溜土豆丝", "风琴土豆"], ["炸红薯", "芋泥"]],
    ["beans", ["豆浆", "胡豆", "鸡豆凉粉"], ["咖啡豆", "可可豆"]],
    ["candies", ["水果糖", "牛轧糖", "寸金糖"], ["饼干", "雪糕"]],
    ["nuts-seeds", ["花生", "南瓜子", "菠萝蜜核"], ["黄豆", "爆米花"]],
    ["breads", ["吐司", "盐可颂", "凯撒面包"], ["奶油蛋糕", "馒头"]],
    ["sauces", ["番茄酱", "咖央酱", "奇米丘里酱"], ["盐", "橄榄油"]],
    ["lamps", ["台灯", "阅读灯", "戴维灯"], ["手机", "萤火虫"]],
    ["furniture", ["餐桌", "折叠椅", "衣帽间中岛柜"], ["电视", "床单"]],
    ["measuring-tools", ["卷尺", "万用表", "轮廓规"], ["手机", "公斤"]],
    ["sewing-supplies", ["缝衣针", "拆线器", "织补蘑菇"], ["衬衫", "棉布"]],
    ["textiles", ["棉布", "莱赛尔", "夏布"], ["皮革", "海绵"]],
    ["cookware", ["炒锅", "高压锅", "云南汽锅"], ["电饭煲", "锅盖"]],
    ["shoes", ["运动鞋", "乐福鞋", "分趾鞋"], ["袜子", "鞋带"]],
    ["outerwear", ["羽绒服", "皮夹克", "牛角扣大衣"], ["内衣", "围巾"]],
    ["ball-sports", ["乒乓球", "轮椅篮球", "合球"], ["围棋", "跳绳"]],
    ["card-games", ["斗地主", "空当接龙", "克里比奇"], ["麻将", "UNO"]],
    ["dances", ["芭蕾", "探戈", "曳步舞"], ["转圈", "小苹果"]],
    ["office-equipment", ["复印机", "高拍仪", "自动折页机"], ["办公桌", "打印纸"]],
    ["flying-birds", ["麻雀", "孔雀", "旋木雀"], ["企鹅", "蝙蝠"]],
    ["board-games", ["围棋", "斗兽棋", "海战棋"], ["斗地主", "麻将"]],
    ["amusement-rides", ["云霄飞车", "激流勇进", "旋转观景塔"], ["爆米花", "身高尺"]],
    ["freshwater-fish", ["鲫鱼", "锦鲤", "射水鱼"], ["蓝鲸", "皮皮虾"]],
    ["neighborhood-shops", ["便利店", "配钥匙店", "修伞店"], ["学校", "苹果"]],
    ["weather", ["下雨", "雾凇", "绿色闪光"], ["地震", "流星"]],
    ["vegetables", ["西红柿", "空心菜", "抱子甘蓝"], ["木耳", "豆腐"]],
    ["edible-mushrooms", ["香菇", "白玉菇", "绣球菌"], ["毒蝇伞", "白菜"]],
    ["grains", ["玉米", "藜麦", "福尼奥米"], ["花生", "土豆"]],
    ["cooking-oils", ["花生油", "黄油", "鹅油"], ["汽油", "薰衣草精油"]],
    ["coffee-drinks", ["美式", "白咖啡", "马扎格兰"], ["阿拉比卡", "咖啡蛋糕"]],
    ["bicycle-parts", ["车把", "脚踏", "链条张紧器"], ["头盔", "山地车"]],
    ["dog-breeds", ["金毛", "泰迪", "巴仙吉犬"], ["小白狗", "警犬"]],
    ["flowers", ["玫瑰", "太阳花", "鹤望兰"], ["小麦", "松树"]],
    ["tableware", ["筷子", "汤匙", "芦笋夹"], ["电饭锅", "洗碗机"]],
    ["camera-gear", ["镜头", "偏振镜", "星野赤道仪"], ["手机", "逆光"]],
    ["drawing-supplies", ["铅笔", "油画颜料", "纸擦笔"], ["水彩画", "蒙娜丽莎"]],
    ["cakes", ["巧克力蛋糕", "棋格蛋糕", "年轮蛋糕"], ["菠萝包", "月饼"]],
  ];
  assert.deepEqual(examples.map(([id]) => id).sort(), QUESTIONS.map(({ id }) => id).sort());
  for (const [id, accepted, rejected] of examples) {
    for (const value of accepted) assert.ok(judge(q(id), value), `${id}: missing ${value}`);
    for (const value of rejected) assert.equal(judge(q(id), value), null, `${id}: out of scope ${value}`);
  }
});

test("similar names with different identities are not merged", () => {
  for (const [id, first, second] of [
    ["noodle-dishes", "炒河粉", "干炒牛河"],
    ["flowers", "向日葵", "太阳花"],
    ["marine-animals", "儒艮", "海牛"],
    ["nuts-seeds", "杏仁", "巴旦木"],
    ["cakes", "纸杯蛋糕", "玛芬"],
    ["bicycle-parts", "刹车皮", "来令片"],
  ]) {
    const a = judge(q(id), first), b = judge(q(id), second);
    assert.ok(a && b, id);
    assert.notEqual(a.answer, b.answer, id);
  }
});

test("guesses must be complete single answers; a typo is never automatically awarded points", () => {
  for (const value of ["", " ", "钢笔橡皮", "钢笔、橡皮", "钢笔/橡皮", "我选钢笔", "<script>钢笔</script>"]) assert.equal(judge(q("stationery"), value), null);
  assert.equal(judge(q("bathroom-items"), "挤牙膏机"), null);
  assert.equal(suggest(q("bathroom-items"), "挤牙膏机"), "挤牙膏器");
  assert.equal(suggest(q("stationery"), "手几"), null);
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

test("fresh free-play seeds produce distinct rounds while a replayed seed stays stable", () => {
  const date = "2026-09-16";
  for (const pack of Object.keys(PACKS)) {
    const rounds = Array.from({ length: 20 }, (_, i) => newDive("unlimited", date, `session-${i}`, pack).ids);
    assert.equal(new Set(rounds.map((ids) => ids.join(","))).size, rounds.length);
    assert.deepEqual(newDive("unlimited", date, "session-0", pack).ids, rounds[0]);
    for (const ids of rounds) assert.equal(new Set(ids).size, 7);
  }
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
