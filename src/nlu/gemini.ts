import { WAITING_PHRASES, pickWaitingPhraseForHint } from "./waitingPhrases.js";

type Role = "user" | "assistant";

type Turn = {
  role: Role;
  text: string;
};

type LlmState = {
  reply: string;
  memory: string;
  waiting_hint?: string;
};

// Paste your full system prompt here
const SYSTEM_PROMPT = `
אתה עוזר קולי בעברית בשיחת טלפון ללקוח של FURNE.

התפקיד שלך:
- להיות הקול הפרימיום של FURNE בטלפון.
- להבין מה הלקוח רוצה לגבי רהיטים / חלל בבית, בצורה אמפתית, חכמה ומהירה.
- להמליץ על רהיטים יפים, על־המותג, שמתאימים לחלל, לטעם ולמגבלות של הלקוח.
- להוביל את הלקוח לצעד הבא ברור: בחירת כיוון, קבלת מדיה (קטלוגים, תמונות, סרטונים קצרים) או קביעת שיחה / ביקור.
- לשמור "זיכרון" דחוס של מה שחשוב על הלקוח בשיחה.
- בכל תשובה גם "לחזות" איזה משפט המתנה קצר יהיה טבעי להגיד ללקוח לפני התשובה הבאה, ולהחזיר אותו בשדה waiting_hint.

מטרות השיחה (Mission & Outcomes)
- להבין את הפרויקט של הלקוח: איזה חלל, מה המצב היום, מה החלום שלו, ומה חשוב לו.
- לגלות את ההעדפות: סגנון, צבעים, חומרים, רמת נוחות, שימוש יומיומי, ילדים / חיות / לכלוך.
- להמליץ על רהיטים שמתאימים גם לעיצוב וגם לפרקטיקה (גודל, יחס לחדר, תקציב).
- לעזור ללקוח לראות את זה בעיניים: להסביר איך הרהיט ייראה בחלל, באיזה גימורים, ואיך זה תורם לאווירה.
- כשהלקוח בשל: להוביל בעדינות לשלב הבא – קבלת מדיה מותאמת (קטלוג, לוקבוק, קלוז־אפים, וידאו קצר) או קביעת פגישה / ייעוץ.

מה אתה מקבל כחומר גלם (מאוחר יותר בפרומפט)
בכל קריאה אתה תקבל בנוסף לטקסט הזה:

1. רשימת משפטי המתנה מוקלטים (waiting phrases)
   - הרשימה תופיע כקווים נפרדים, וכל שורה תיראה בערך כך:
     [happy] כן בטח!
     [calm] אין בעיה.
     [friendly] סבבה, אני איתך.
   - בתחילת כל משפט יש טאג רגשי באנגלית בסוגריים מרובעים, למשל: [happy], [calm], [friendly], [upbeat], [neutral], [warm] וכו׳.
   - אחרי הטאג יש את הטקסט בעברית, שהוא מה שהלקוח היה שומע בפועל.
   - אתה לא ממציא משפטים חדשים – אתה תמיד בוחר משהו זהה או מאוד קרוב לאחד המשפטים ברשימה.

   לוגיקת בחירת waiting_hint:
   - בכל תשובה אתה צריך לבחור *משפט המתנה אחד* שמתאים לפתיחה של התשובה הבאה.
   - אתה מסתכל על:
     • מצב הרגש של השיחה כרגע (מה הלקוח אמר).  
     • הטון שאתה משתמש בו בתשובה שלך (לפי הטאגים [happy] / [calm] / [thinking] וכו’ בתוך reply).  
     • הטאגים הרגשיים של משפטי ההמתנה ברשימה ([happy], [calm], [friendly] וכו’).
   - לא בוחרים משפט אקראי:
     • אם בתשובה שלך השתמשת בטאג ראשי כמו [happy] – תעדיף לבחור משפט מהרשימה שהטאג שלו גם [happy] או משהו קרוב בטון (למשל [upbeat] / [bright]).  
     • אם התשובה שלך יותר רגועה / מסבירה עם [calm] או [serious] – תעדיף משפט עם טון רגוע כמו [calm] / [neutral].  
     • אם הלקוח עצבני ואתה מנסה להרגיע – תבחר משהו רגוע, לא [excited].
   - בשדה waiting_hint אתה מחזיר רק את המשפט בעברית, בלי הטאג הרגשי.
     לדוגמה:
     • ברשימה מופיע: [happy] כן בטח!  
       אז ב-waiting_hint תחזיר: "כן בטח!"
     • ברשימה מופיע: [calm] אין בעיה.  
       אז ב-waiting_hint תחזיר: "אין בעיה."
   - חשוב:
     • waiting_hint חייב להיות זהה או מאוד קרוב לאחד המשפטים ברשימה (אחרי שמורידים ממנו את הטאג).  
     • אל תחזיר טקסט אקראי שלא קיים ברשימה.  
     • אם אתה ממש לא מוצא משפט מתאים, אתה יכול להחזיר מחרוזת ריקה "" ב-waiting_hint.

2. קטלוג מוצרים מלא – טקסט ארוך בעברית, עם בלוקים של מוצרים בפורמט:
   מוצר  
   כל השדות  
   קטגוריה: …  
   סגנון: …  
   חדר: …  
   חומר: …  
   גימור: …  
   צבע: …  
   מצב מלאי: …  
   יוקרתי: כן/לא  
   דרגת קושי: …  
   שם מוצר: …  
   מזהה מוצר: …  
   מחיר: …  
   תיאור: …  

   החוקים לגבי הקטלוג:
   - כשאתה ממליץ על רהיטים, תעדיף לבחור מוצרים מתוך הקטלוג הזה.
   - אם אפשר, תזכיר ללקוח גם "שם מוצר" וגם "מזהה מוצר".
   - אם אין מוצר שמתאים בול, תגיד שזה הכי קרוב ותסביר למה.
   - לא להמציא מוצרים שלא מופיעים בקטלוג.

סגנון דיבור – עברית טבעית ונמוכה
- לדבר כמו ישראלי רגיל, לא כמו ספר לימוד.
- מותר וראוי להשתמש בשפה יומיומית, גם אם לא לגמרי תקנית:
  • "אני לא יוכל לעשות את זה" (לא תקני, אבל טבעי).  
  • "בוא נעשה רגע סדר".  
  • "יש מצב שזה יותר יתאים לסלון שלך".  
  • "בא לך לספר לי רגע מה הגודל של החדר?".
- להימנע מלשון גבוהה / רשמית מדי:
  • לא "איני יכול לסייע בנושא זה".  
  • לא "אוכל לספק לך מענה בנושא".
- מילים טבעיות: "סבבה", "אחלה", "סבבה לגמרי", "יאללה", "בא לי", "לא כזה", "נראה לי".
- לא להגזים ולא להעליב לקוח, גם אם הוא מדבר לא יפה.

טון המותג FURNE
- חם, מקצועי, אלגנטי, אבל מדבר כמו בן אדם.
- אפשר סלנג עדין, בלי להפוך לחבר מהשכונה.
- תמיד עם כבוד, סבלנות ונעימות, גם כשעוצרים בקשה לא מתאימה.
- כשמסבירים על מוצרים – אפשר להיות קצת "סינמטי": לתאר מרקם, תחושה, אווירה.

מדיניות INFO-FIRST
כששואלים "מה אתם עושים" / "מה החברה שלכם":
1. קודם להסביר מה FURNE מציעה:
   - רהיטים פרימיום, עיצוב לחללים בבית, חומרים איכותיים, שירות, זמנים, משלוח.
2. רק אחרי זה, בעדינות, להציע:
   - ייעוץ קצר (טלפוני / וידאו) או ביקור (אם זה רלוונטי).
3. אם הלקוח ממשיך לשאול שאלות מידע:
   - להמשיך לתת מידע ברור,
   - ובמקביל להמשיך לכוון בעדינות לצעד הבא (למשל: "אם תרצה, אני יכול לעזור לך לבחור כיוון לסלון ולשלוח לך קטלוג רלוונטי").

טאגים רגשיים ב-[סוגריים מרובעים] בתוך reply
בתוך השדה "reply" אתה יכול (ורצוי) להשתמש בטאגים קצרים באנגלית כדי לסמן מצב רגשי / טון:
- [happy] – שמח, זורם.
- [calm] – רגוע, מרגיע.
- [thinking] – חושב, מחפש פתרון.
- [apologetic] – מתנצל.
- [excited] – קצת מתלהב.
- [serious] – ענייני, קצת יותר רשמי.

דוגמה:
[happy] בשמחה! [thinking] כדי שאוכל להמליץ לך על משהו שתאהב, ספר לי רגע על איזה חלל בבית מדובר, ואיזה סגנון פחות או יותר אתה מחפש?

חוקים:
- להשתמש בטאגים רק בתוך "reply".
- הטאגים תמיד באנגלית ובדיוק כמו: [happy], [thinking], [calm] וכו’.
- בדרך כלל 1–2 טאגים לתשובה זה מספיק.
- לא להשתמש בטאגים ב-"memory" ולא ב-"waiting_hint".
- כשאתה בוחר waiting_hint מהרשימה, תתחשב בטאגים שהשתמשת בהם ב-reply כדי שהטון של משפט ההמתנה יתאים לטון שלך.

אורך וסגנון תשובה
- תשובות קצרות: משפט אחד או שניים.
- כשצריך קצת יותר הסבר – עד שלושה משפטים קצרים, לא נאום.
- לשמור על זרימה: לא להישמע רובוטי, לשנות ניסוחים, לא לחזור על אותה תשובה.
- אם השאלה לא ברורה:
  "[thinking] לא בטוח שהבנתי עד הסוף, תנסה לנסח שוב בקצרה?"

שאלות לא קשורות / גסות / לא מתאימות
בשדה "reply":
- להגיב בעדינות שזה לא משהו שאתה יכול לעזור בו.
- ולהציע לדבר על רהיטים / עיצוב / הבית.

לדוגמה:
"[serious] אני לא יוכל לעזור עם זה, אבל בכיף אנסה לעזור לך עם רהיטים או עיצוב לבית."

בשדה "memory":
- לציין שהייתה שאלה לא קשורה / לא הולמת, בלי להיכנס לפרטים.

לולאת שיחה בסיסית (Core Conversation Loop)

1. דיסקברי – שאלות (Question / [thinking] / [calm])

חלל וסגנון:
- איזה חדר? (סלון, חדר שינה, פינת אוכל וכו’).
- יש לך מושג על מידות בערך? (גם תשובה "אין לי מושג" לגיטימית).
- מה הפלטת צבעים בערך? קירות, רצפה, רהיטים קיימים.
- איך האור בחדר? (שמש, כהה, מעורב).

שימוש ונוחות:
- יש ילדים / חיות?
- יותר לאירוח או לזריקה על הספה סוף יום?

מגבלות:
- תקציב בערך (טווח, לא חייב מספר מדויק).
- לוחות זמנים (דחוף / גמיש).
- קומה, מעלית, מדרגות, רוחב כניסה.

אסתטיקה:
- כיוון עיצובי: מודרני, סקנדינבי, קלאסי, חמים, כהה, בהיר.
- גימורים אהובים: עץ בהיר / כהה, מתכת, בד חלק / מחוספס וכו’.

2. המלצה – Recommendation ([calm] / [serious] / [demo])
- להציע לרוב 1–2 כיוונים, לא להציף:
  • איזה סגנון / דגם / סוג רהיט.  
  • איך זה משתלב בחדר (גודל, צבע, אווירה).  
  • חומרים, רמת נוחות, תחזוקה.
- אם אפשר, להזכיר שיקולים פרקטיים (לכלוך, ילדים, חיות).

3. שימוש בקטלוג המוצרים
- כשאתה ממליץ על כיוון, חפש בראש קודם מהקטלוג שקיבלת:
  • האם יש מוצר אחד או שניים שמתאימים למה שהלקוח תיאר?  
  • אם כן – תן המלצה ברורה כמו:
    "נשמע לי שמתאים לך שולחן העבודה Belvedere Desk, מזהה P-013, עם העור הירוק והגימור אלון הטבעי שתיארת."
- אפשר גם להציע "כיוונים" כלליים ואז לציין דוגמה מקטלוג:
  "[thinking] בגדול נשמע שמתאים לך משהו סקנדינבי בהיר, ואני חושב ש־Aurelia Sofa / P-001 יכול לעבוד לך טוב."
- אם אין משהו מתאים לגמרי:
  • להגיד שזה הכי קרוב, ולהסביר למה.  
  • לא להמציא מוצרים שלא קיימים בטקסט שקיבלת.

4. הוכחה / המחשה – Proof ([demo])
- להציע לשלוח מדיה:
  • עמוד לוקבוק, קטלוג, תמונות קלוז־אפ, או וידאו קצר.
- לתאר מה הלקוח יקבל:
  • "תראה שם איך הגימור נראה באור טבעי".  
  • "יש שם תמונות בחדרים דומים למה שתיארת".

5. צעד הבא – Next Step ([happy] / [serious])
- להוביל בעדינות:
  • "אם בא לך, אני יכול לכוון אותך לכמה דגמים שמתאימים בול למה שתיארת".  
  • "נוכל גם לעשות שיחה קצרה מסודרת, לעבור על אופציות ולוודא שזה יושב טוב על החלל שלך".

דינמיקת שיחה אנושית
- תמיד גוף ראשון:
  • "אני מבין", "נשמע טוב", "אני חושב שזה יכול לעבוד לך".
- לא להשתמש בשפה רובוטית / טכנית מדי.
- להראות אמפתיה:
  • "מבין אותך, זה באמת מבלבל לבחור".  
  • "סבבה לגמרי, לא כולם אוהבים צבעים חזקים".
- לשמור על איזון בין מקצועיות לבין קלילות.

מבנה התשובה שאתה מחזיר לשרת
אתה תמיד חייב להחזיר רק JSON תקין, עם שלושה שדות בלבד:

{
  "reply": "מה שאתה אומר עכשיו ללקוח בעברית מדוברת, כולל טאגים כמו [happy] אם מתאים",
  "memory": "סיכום קצר בעברית (עד ~30 מילים) של מה שאנחנו יודעים על הלקוח עד עכשיו, מה הוא מחפש, ומה חשוב לזכור להמשך",
  "waiting_hint": "משפט המתנה קצר בעברית, בלי טאגים, שמתאים באופן טבעי לפתיחה של התשובה הבאה, והוא זהה או מאוד קרוב לאחד המשפטים ברשימת משפטי ההמתנה שקיבלת (אחרי שמורידים ממנו את הטאג)"
}

חוקים קשיחים:
- אסור להחזיר שום טקסט מחוץ ל-JSON.
- אסור להוסיף שדות אחרים ב-JSON (לא actions, לא responses, לא שום דבר נוסף).
- בשדה reply:
  • לא כותבים "assistant:", "system:", "user:" וכדומה.  
  • רק הטקסט עצמו בעברית + טאגים באנגלית אם צריך.
- בשדה memory:
  • בלי טאגים בכלל.  
  • רק טקסט רגיל, קצר וברור.
- בשדה waiting_hint:
  • ללא טאגים, ללא סוגריים, רק המשפט עצמו בעברית.  
  • לבחור משפט שמתאים רגשית למה שקורה עכשיו בשיחה.  
  • להשתמש בטאגים ברשימת המשפטים כדי להחליט מה הכי מתאים, אבל להחזיר רק את הטקסט בעברית.

הגדרת ה-"memory"
- תמיד טקסט שאפשר להבין בפני עצמו, בלי לראות היסטוריה.
- כולל:
  • מי הלקוח / מה הוא מחפש (אם ידוע).  
  • על איזה חלל / רהיט מדובר.  
  • העדפות בולטות (צבעים, סטייל, תקציב, מידות, ילדים/חיות).  
  • מה הצעד הבא שהוא רוצה (המלצה, לראות אופציות, להשוות וכו’).
- אם זו תחילת שיחה ואין כמעט מידע:
  • "תחילת שיחה, עדיין אין פרטים חשובים על העדפות הלקוח."

Guardrails כלליים
- לא לענות על נושאים שלא קשורים לרהיטים / בית / עיצוב:
  • להסביר בעדינות שזה לא התחום, ולהחזיר את השיחה לנושא המתאים.
- לא להמציא הבטחות שקשורות לכסף, החזרות, אחריות – אם לא ברור מה המדיניות:
  • להשתמש בניסוח רך: "בגדול המדיניות היא..." או "בדרך כלל...", בלי הבטחה נוקשה.
- תמיד להישאר רגוע, גם אם הלקוח עצבני / ציני.

תזכורת אחרונה:
- לדבר בשפה יומיומית וטבעית.
- לזרום עם השיחה, לשאול שאלות חכמות, ולהוביל לצעד הבא בלי לחץ.
- תמיד להחזיר JSON תקין בלבד, ללא טקסט חיצוני.
`.trim();

// Paste your full product catalog here (optional)
// When empty, the model will not see any catalog.
const PRODUCT_CATALOG_RAW = `
מוצר

כל השדות

קטגוריה: ספה
סגנון: סקנדינבי
חדר: סלון
חומר: עץ מלא
גימור: אלון טבעי
צבע: טבעי
מצב מלאי: במלאי
יוקרתי: כן
דרגת קושי: רך
שם מוצר: Aurelia Sofa
מזהה מוצר: P-001
מחיר: 3502
תיאור: ספה מעץ מלא בסגנון סקנדינבי ובגוון טבעי. מושלמת לסלון. מיועדת לשדרג את הנוחות היומיומית ולהיראות נהדר במשך שנים.

מוצר

כל השדות

קטגוריה: ספה פינתית
סגנון: מודרני
חדר: חדר אוכל
חומר: עץ מהונדס
גימור: אלון בהיר
צבע: בז'
מצב מלאי: מלאי נמוך
יוקרתי: לא
דרגת קושי: בינוני
שם מוצר: Valora Sofa
מזהה מוצר: P-002
מחיר: 8294
תיאור: ספה פינתית מעץ מהונדס בגוון בז' בסגנון מודרני. מושלמת לחדר אוכל. מיועדת לשדרג את הנוחות היומיומית ולהיראות נהדר במשך שנים.

מוצר

כל השדות

קטגוריה: כורסה
סגנון: מינימליסטי
חדר: חדר שינה
חומר: פורניר
גימור: אגוז
צבע: חול
מצב מלאי: בהזמנה לאחר חידוש מלאי (Backorder)
יוקרתי: כן
דרגת קושי: קשיח
שם מוצר: Monarch Armchair
מזהה מוצר: P-003
מחיר: 4985
תיאור: כורסה מפורניר בגוון חול בסגנון מינימליסטי. מושלמת לחדר שינה. מיועדת לשדרג את הנוחות היומיומית ולהיראות נהדר במשך שנים.

מוצר

כל השדות

קטגוריה: ספת זוגית (Loveseat)
סגנון: תעשייתי
חדר: משרד ביתי
חומר: מתכת
גימור: אספרסו
צבע: שנהב
מצב מלאי: טרום הזמנה (Preorder)
יוקרתי: לא
דרגת קושי: רך
שם מוצר: Seraphine Sofa
מזהה מוצר: P-004
מחיר: 6057
תיאור: ספת זוגית ממתכת בגוון שנהב בסגנון תעשייתי. מושלמת למשרד ביתי. מיועדת לשדרג את הנוחות היומיומית ולהיראות נהדר במשך שנים.

מוצר

כל השדות

קטגוריה: כורסה נפתחת (Recliner)
סגנון: כפרי
חדר: חדר ילדים
חומר: נירוסטה
גימור: שחור
צבע: אפור בהיר
מצב מלאי: מופסק / לא מיוצר עוד (Discontinued)
יוקרתי: כן
דרגת קושי: בינוני
שם מוצר: Cortona Accent
מזהה מוצר: P-005
מחיר: 9295
תיאור: כורסה נפתחת מנירוסטה בגוון אפור בהיר בסגנון כפרי. מושלמת לחדר ילדים. מיועדת לשדרג את הנוחות היומיומית ולהיראות נהדר במשך שנים.

מוצר

כל השדות

קטגוריה: כיסא אוכל
סגנון: קלאסי
חדר: אזור כניסה
חומר: אלומיניום
גימור: לבן
צבע: אפור
מצב מלאי: במלאי
יוקרתי: לא
דרגת קושי: קשיח
שם מוצר: Portofino Chair
מזהה מוצר: P-006
מחיר: 8309
תיאור: כיסא אוכל מאלומיניום בגוון אפור בסגנון קלאסי. מושלם לאזור הכניסה. מיועד לשדרג את הנוחות היומיומית ולהיראות נהדר במשך שנים.

מוצר

כל השדות

קטגוריה: שולחן אוכל
סגנון: מיד סנצ'ורי (Mid-Century)
חדר: חוץ
חומר: זכוכית
גימור: אפור
צבע: פחם (Charcoal)
מצב מלאי: מלאי נמוך
יוקרתי: כן
דרגת קושי: רך
שם מוצר: Palermo Dining Table
מזהה מוצר: P-007
מחיר: 9274
תיאור: שולחן אוכל מזכוכית בגוון פחם בסגנון מיד סנצ'ורי. מושלם לחוץ. מיועד לשדרג את הנוחות היומיומית ולהיראות נהדר במשך שנים.

מוצר

כל השדות

קטגוריה: שרפרף בר
סגנון: עכשווי (Contemporary)
חדר: חדר רחצה
חומר: שיש
גימור: פלדה מוברשת
צבע: שחור
מצב מלאי: בהזמנה לאחר חידוש מלאי (Backorder)
יוקרתי: לא
דרגת קושי: בינוני
שם מוצר: Sorrento Stool
מזהה מוצר: P-008
מחיר: 5481
תיאור: שרפרף בר משיש שחור בסגנון עכשווי. מושלם לחדר רחצה. מיועד לשדרג את הנוחות היומיומית ולהיראות נהדר במשך שנים.

מוצר

כל השדות

קטגוריה: שולחן קפה
סגנון: יאפנדי (Japandi)
חדר: סלון
חומר: קרמיקה
גימור: כרום
צבע: לבן
מצב מלאי: טרום הזמנה (Preorder)
יוקרתי: כן
דרגת קושי: קשיח
שם מוצר: Marbella Coffee Table
מזהה מוצר: P-009
מחיר: 5466
תיאור: שולחן קפה מקרמיקה לבנה בסגנון יאפנדי. מושלם לסלון. מיועד לשדרג את הנוחות היומיומית ולהיראות נהדר במשך שנים.

מוצר

כל השדות

קטגוריה: שולחן צד
סגנון: בוהו (Boho)
חדר: חדר אוכל
חומר: ראטן
גימור: פליז
צבע: אגוז
מצב מלאי: מופסק / לא מיוצר עוד (Discontinued)
יוקרתי: לא
דרגת קושי: רך
שם מוצר: Riviera Side Table
מזהה מוצר: P-010
מחיר: 1786
תיאור: שולחן צד מראטן בגוון אגוז בסגנון בוהו. מושלם לחדר אוכל. מיועד לשדרג את הנוחות היומיומית ולהיראות נהדר במשך שנים.

מוצר

כל השדות

קטגוריה: שולחן קונסולה (Console Table)
סגנון: סקנדינבי
חדר: חדר שינה
חומר: נצרים (Wicker)
גימור: מט
צבע: אלון
מצב מלאי: במלאי
יוקרתי: כן
דרגת קושי: בינוני
שם מוצר: Montclair Console Table
מזהה מוצר: P-011
מחיר: 2149
תיאור: שולחן קונסולה מנצרים בגוון אלון בסגנון סקנדינבי. מושלם לחדר שינה. מיועד לשדרג את הנוחות היומיומית ולהיראות נהדר במשך שנים.

מוצר

כל השדות

קטגוריה: מזנון טלוויזיה (TV Unit)
סגנון: מודרני
חדר: משרד ביתי
חומר: בד
גימור: מבריק (Gloss)
צבע: כחול
מצב מלאי: מלאי נמוך
יוקרתי: לא
דרגת קושי: קשיח
שם מוצר: Savoy Media Console
מזהה מוצר: P-012
מחיר: 5610
תיאור: מזנון טלוויזיה מבד בגוון כחול בסגנון מודרני. מושלם למשרד ביתי. מיועד לשדרג את הנוחות היומיומית ולהיראות נהדר במשך שנים.

מוצר

כל השדות

קטגוריה: שולחן עבודה (Desk)
סגנון: מינימליסטי
חדר: חדר ילדים
חומר: עור
גימור: אלון טבעי
צבע: ירוק
מצב מלאי: בהזמנה לאחר חידוש מלאי (Backorder)
יוקרתי: כן
דרגת קושי: רך
שם מוצר: Belvedere Desk
מזהה מוצר: P-013
מחיר: 8252
תיאור: שולחן עבודה מעור ירוק בסגנון מינימליסטי, עם גימור אלון טבעי. מושלם לחדר ילדים. מיועד לשדרג את הנוחות היומיומית ולהיראות נהדר במשך שנים.

מוצר

כל השדות

קטגוריה: כיסא משרדי
סגנון: תעשייתי
חדר: אזור כניסה
חומר: דמוי עור
גימור: אלון בהיר
צבע: טרקוטה
מצב מלאי: טרום הזמנה (Preorder)
יוקרתי: לא
דרגת קושי: בינוני
שם מוצר: Arcadia Chair
מזהה מוצר: P-014
מחיר: 3466
תיאור: כיסא משרדי מדמוי עור בגוון טרקוטה בסגנון תעשייתי. מושלם לאזור הכניסה. מיועד לשדרג את הנוחות היומיומית ולהיראות נהדר במשך שנים.

מוצר

כל השדות

קטגוריה: מיטה
סגנון: כפרי
חדר: חוץ
חומר: מיקרופייבר
גימור: אגוז
צבע: טבעי
מצב מלאי: מופסק / לא מיוצר עוד (Discontinued)
יוקרתי: כן
דרגת קושי: קשיח
שם מוצר: Opaline Bed
מזהה מוצר: P-015
מחיר: 4937
תיאור: מיטה ממיקרופייבר בגוון טבעי בסגנון כפרי. מושלמת לחוץ. מיועדת לשדרג את הנוחות היומיומית ולהיראות נהדר במשך שנים.

מוצר

כל השדות

קטגוריה: מזרן
סגנון: קלאסי
חדר: חדר רחצה
חומר: בטון
גימור: אספרסו
צבע: בז'
מצב מלאי: במלאי
יוקרתי: לא
דרגת קושי: רך
שם מוצר: Nocturne Accent
מזהה מוצר: P-016
מחיר: 1988
תיאור: מזרן מבטון בגוון בז' בסגנון קלאסי. "מושלם" לחדר רחצה לפי ההגדרה. מיועד לשדרג את הנוחות היומיומית ולהיראות נהדר במשך שנים.
`.trim();

export class LlmSession {
  private history: Turn[] = [];
  private memory: string | null = null;
  private waitingHint: string | null = null;

  // waiting clip state (for telephony layer)
  private pendingWaitingClipId: string | null = null;
  private lastWaitingClipId: string | null = null;

  private readonly apiKey: string;
  private readonly model: string;

  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || "";
    this.model = process.env.LLM_MODEL || "gemini-2.5-flash-lite";

    if (!this.apiKey) {
      console.error(
        "[LLM] GEMINI_API_KEY is not set – running in fallback mode without Gemini calls"
      );
    } else {
      console.log("[LLM] using model:", this.model);
    }
  }

  // Allow external consumers (debugging / logging) to read latest waiting_hint
  getWaitingHint(): string | null {
    return this.waitingHint;
  }

  // Read the pending waiting clip id (for the *next* turn) and clear it
  getPendingWaitingClipIdAndClear(): string | null {
    const id = this.pendingWaitingClipId;
    this.pendingWaitingClipId = null;
    return id ?? null;
  }

  // Logging helper
  private logIO(input: string, output?: string) {
    console.log("[LLM in ]", input);
    if (output != null) console.log("[LLM out]", output);
  }

  // Strip ```json ... ``` fences if the model returns code blocks
  private stripCodeFence(text: string): string {
    if (!text) return "";
    const trimmed = text.trim();
    if (!trimmed.startsWith("```")) return trimmed;

    const withoutFirst = trimmed.replace(/^```[a-zA-Z0-9_-]*\s*\r?\n/, "");
    const withoutLast = withoutFirst.replace(/\r?\n```$/, "");
    return withoutLast.trim();
  }

  // Fallback extraction of a field from raw text if JSON parsing fails
  private extractFieldFromRaw(raw: string, key: string): string | null {
    if (!raw) return null;
    const lower = raw.toLowerCase();
    const idx = lower.indexOf(key.toLowerCase());
    if (idx < 0) return null;

    const afterKey = raw.slice(idx);
    const line = afterKey.split(/\r?\n/)[0] ?? afterKey;

    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) return null;

    let value = line.slice(colonIdx + 1).trim();
    if (!value) return null;

    value = value.replace(/[,\}]+$/, "").trim();
    value = value.replace(/^["']/, "").replace(/["']$/, "").trim();

    return value || null;
  }

  // Remove prefixes like "reply:" from the reply text
  private stripReplyPrefix(text: string): string {
    return text
      .replace(/^\s*["']?\s*reply["']?\s*[:\-–]?\s*/i, "")
      .trim();
  }

  // Build the full prompt for Gemini (system + waiting phrases + catalog + memory + user text)
  private buildPrompt(userText: string): string {
    const currentMemory =
      this.memory && this.memory.trim().length > 0
        ? this.memory
        : "אין עדיין זיכרון משמעותי, זו תחילת השיחה.";

    const lines: string[] = [];

    // System prompt
    lines.push(SYSTEM_PROMPT);
    lines.push("");

    // Waiting phrases list (for waiting_hint selection)
    if (WAITING_PHRASES.length > 0) {
      const waitingList = WAITING_PHRASES.map(
        (p, idx) => `${idx + 1}. "${p.text}"`
      ).join("\n");
      lines.push(
        "אלה משפטי ההמתנה המוקלטים שאתה יכול לבחור מהם ב-waiting_hint (אל תמציא חדשים):"
      );
      lines.push(waitingList);
      lines.push("");
    }

    // Product catalog (if provided)
    if (PRODUCT_CATALOG_RAW.trim()) {
      lines.push(
        "קטלוג המוצרים המלא שעומד לרשותך (אל תשנה את הטקסט, רק תשתמש בו כמידע להמלצות):"
      );
      lines.push(PRODUCT_CATALOG_RAW.trim());
      lines.push("");
    }

    // Memory + new user message
    lines.push("זיכרון השיחה הנוכחי (memory):");
    lines.push(currentMemory);
    lines.push("");
    lines.push("הודעת הלקוח החדשה:");
    lines.push(userText);
    lines.push("");
    lines.push(
      "ענה אך ורק ב-JSON תקין עם השדות reply, memory, waiting_hint בלבד, ללא טקסט נוסף, ובלי ```."
    );

    return lines.join("\n");
  }

  // Low-level call to Gemini that returns structured state (reply, memory, waiting_hint)
  private async generate(userText: string): Promise<LlmState> {
    const cleaned = (userText || "").trim();

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      this.model
    )}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const maxTokensEnv = process.env.LLM_MAX_TOKENS;
    const rawMax =
      maxTokensEnv != null && maxTokensEnv !== ""
        ? Number(maxTokensEnv)
        : NaN;
    const temperature = Number(process.env.LLM_TEMPERATURE || "0.7");
    const timeoutMs = Number(process.env.LLM_TIMEOUT_MS || "0");

    const generationConfig: any = {
      temperature,
      responseMimeType: "application/json",
    };

    if (Number.isFinite(rawMax) && rawMax > 0) {
      generationConfig.maxOutputTokens = rawMax;
    }

    const prompt = this.buildPrompt(cleaned);

    const body = {
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig,
    };

    const ctrl = new AbortController();
    const timeout =
      timeoutMs > 0 ? setTimeout(() => ctrl.abort(), timeoutMs) : null;

    try {
      this.logIO(cleaned);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        console.error("[LLM] HTTP error:", res.status, text);
        const fallback =
          "הייתה תקלה קטנה רגע, תנסה שוב.";
        this.logIO(cleaned, fallback);
        return {
          reply: fallback,
          memory: this.memory ?? "",
          waiting_hint: this.waitingHint ?? undefined,
        };
      }

      const data: any = await res.json();
      const candidate = data?.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const raw =
        parts
          .map((p: any) => p?.text)
          .filter((t: any) => typeof t === "string")
          .join(" ")
          .trim() || "";

      console.log("[LLM raw]", raw);

      const jsonText = this.stripCodeFence(raw);

      let replyText = jsonText;
      let newMemory = this.memory ?? "";
      let newWaitingHint: string | undefined =
        this.waitingHint ?? undefined;

      try {
        const parsed = JSON.parse(jsonText) as Partial<LlmState>;
        if (typeof parsed.reply === "string" && parsed.reply.trim()) {
          replyText = parsed.reply.trim();
        }
        if (typeof parsed.memory === "string" && parsed.memory.trim()) {
          newMemory = parsed.memory.trim();
        }
        if (
          typeof parsed.waiting_hint === "string" &&
          parsed.waiting_hint.trim()
        ) {
          newWaitingHint = parsed.waiting_hint.trim();
        }
      } catch {
        console.warn("[LLM] failed to parse JSON, trying fallback extraction");

        const replyCandidate = this.extractFieldFromRaw(jsonText, "reply");
        if (replyCandidate) {
          replyText = replyCandidate;
        }

        const memCandidate = this.extractFieldFromRaw(jsonText, "memory");
        if (memCandidate) {
          newMemory = memCandidate;
        }

        const waitingCandidate = this.extractFieldFromRaw(
          jsonText,
          "waiting_hint"
        );
        if (waitingCandidate) {
          newWaitingHint = waitingCandidate;
        }
      }

      replyText = this.stripReplyPrefix(replyText);

      const finalReply =
        replyText ||
        "לא בטוח שהבנתי עד הסוף, תסביר שוב מה אתה רוצה שאני אעשה בשבילך?";

      return {
        reply: finalReply,
        memory: newMemory,
        waiting_hint: newWaitingHint,
      };
    } catch (e: any) {
      if (e?.name === "AbortError") {
        console.error("[LLM] request aborted by timeout");
      } else {
        console.error("[LLM] request error:", e?.message || e);
      }
      const fallback =
        "יש תקלה זמנית בצד שלי, תנסה שוב עוד רגע.";
      this.logIO(cleaned, fallback);
      return {
        reply: fallback,
        memory: this.memory ?? "",
        waiting_hint: this.waitingHint ?? undefined,
      };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  // PREVIEW: no history, no memory update, no waiting_hint / waiting clip logic
  async replyPreview(userText: string): Promise<string> {
    const cleaned = (userText || "").trim();

    if (!cleaned) {
      const fallback =
        "לא בטוח שהבנתי אותך, תנסה להגיד שוב?";
      this.logIO(userText, fallback);
      return fallback;
    }

    if (!this.apiKey) {
      const fallback =
        "יש לי כרגע תקלה בחיבור למנוע החכם, אבל אני איתך. תנסה להסביר שוב בפשטות מה אתה צריך.";
      this.logIO(cleaned, fallback);
      return fallback;
    }

    const state = await this.generate(cleaned);
    return state.reply;
  }

  // FINAL: updates history, memory, waiting_hint and pre-computes waiting clip id
  async replyFinal(userText: string): Promise<string> {
    const cleaned = (userText || "").trim();

    if (!cleaned) {
      const fallback =
        "לא בטוח שהבנתי אותך, תנסה להגיד שוב?";
      this.logIO(userText, fallback);
      return fallback;
    }

    if (!this.apiKey) {
      const fallback =
        "יש לי כרגע תקלה בחיבור למנוע החכם, אבל אני איתך. תנסה להסביר שוב בפשטות מה אתה צריך.";
      this.history.push({ role: "user", text: cleaned });
      this.history.push({ role: "assistant", text: fallback });
      this.logIO(cleaned, fallback);
      return fallback;
    }

    this.history.push({ role: "user", text: cleaned });

    const state = await this.generate(cleaned);

    const newMemory =
      typeof state.memory === "string" && state.memory.trim()
        ? state.memory.trim()
        : this.memory;
    this.memory = newMemory ?? null;

    const newWaiting =
      typeof state.waiting_hint === "string" && state.waiting_hint.trim()
        ? state.waiting_hint.trim()
        : null;

    if (newWaiting) {
      this.waitingHint = newWaiting;
      console.log("[LLM waiting_hint]", this.waitingHint);

      // Map waiting_hint text/id → concrete clipId, with last-id awareness
      const phrase = pickWaitingPhraseForHint(
        this.waitingHint,
        this.lastWaitingClipId
      );
      if (phrase) {
        this.pendingWaitingClipId = phrase.id;
        this.lastWaitingClipId = phrase.id;
      } else {
        this.pendingWaitingClipId = null;
      }
    } else {
      this.waitingHint = null;
      this.pendingWaitingClipId = null;
    }

    const finalReply = state.reply;
    this.history.push({ role: "assistant", text: finalReply });
    this.logIO(cleaned, finalReply);
    return finalReply;
  }
}

export default LlmSession;
