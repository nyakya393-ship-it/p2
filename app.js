/* =========================================================
   SPLATOON 3 WEAPON ANALYZER
   Data source:
   https://splatoonwiki.org/

   起動時：
   1. 武器一覧を取得
   2. 武器画像をまとめて取得
   3. 詳細データは選択した武器だけ取得

   キャッシュ：
   localStorage
========================================================= */

"use strict";


/* =========================================================
   CONFIG
========================================================= */

const API_URL =
    "https://splatoonwiki.org/w/api.php";

const WEAPON_LIST_PAGE =
    "List_of_main_weapons_in_Splatoon_3";

const CACHE_PREFIX =
    "s3_weapon_analyzer_v4_";

const INDEX_CACHE_KEY =
    CACHE_PREFIX + "index";

const INDEX_CACHE_TIME =
    24 * 60 * 60 * 1000;

const DETAIL_CACHE_TIME =
    24 * 60 * 60 * 1000;

const API_TIMEOUT =
    12000;


/* =========================================================
   STATE
========================================================= */

let weapons = [];

let selectedWeapon = null;

let selectedCategory = "all";

let imageMap = new Map();


/* =========================================================
   CATEGORY
========================================================= */

const CATEGORIES = [
    "Shooter",
    "Roller",
    "Charger",
    "Slosher",
    "Splatling",
    "Dualie",
    "Brella",
    "Blaster",
    "Stringer",
    "Splatana"
];


const CATEGORY_JA = {
    Shooter: "シューター",
    Roller: "ローラー",
    Charger: "チャージャー",
    Slosher: "スロッシャー",
    Splatling: "スピナー",
    Dualie: "マニューバー",
    Brella: "シェルター",
    Blaster: "ブラスター",
    Stringer: "ストリンガー",
    Splatana: "ワイパー"
};


/* =========================================================
   DOM
========================================================= */

const $ = id =>
    document.getElementById(id);


/* =========================================================
   UTILITY
========================================================= */

function cleanText(value) {

    return String(value || "")
        .replace(/\s+/g, " ")
        .trim();

}


function titleKey(value) {

    return decodeURIComponent(
        String(value || "")
    )
        .replace(/_/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

}


function escapeHtml(value) {

    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

}


/* =========================================================
   LOCAL STORAGE
========================================================= */

function saveCache(key, value) {

    try {

        localStorage.setItem(
            key,
            JSON.stringify({
                time: Date.now(),
                data: value
            })
        );

    } catch (error) {

        console.warn(
            "localStorage save failed",
            error
        );

    }

}


function loadCache(key, maxAge) {

    try {

        const raw =
            localStorage.getItem(key);

        if (!raw) {
            return null;
        }

        const parsed =
            JSON.parse(raw);

        if (!parsed.time) {
            return null;
        }

        if (
            Date.now() - parsed.time >
            maxAge
        ) {

            localStorage.removeItem(key);

            return null;

        }

        return parsed.data;

    } catch (error) {

        console.warn(
            "localStorage load failed",
            error
        );

        return null;

    }

}


function clearAnalyzerCache() {

    try {

        Object.keys(localStorage)
            .filter(key =>
                key.startsWith(
                    CACHE_PREFIX
                )
            )
            .forEach(key =>
                localStorage.removeItem(key)
            );

    } catch (error) {

        console.warn(
            "cache clear failed",
            error
        );

    }

}


/* =========================================================
   WIKI API
========================================================= */

async function wikiAPI(
    params,
    timeout = API_TIMEOUT
) {

    const url =
        new URL(API_URL);


    const query = {
        ...params,
        format: "json",
        origin: "*"
    };


    Object.entries(query)
        .forEach(
            ([key, value]) => {

                url.searchParams.set(
                    key,
                    value
                );

            }
        );


    const controller =
        new AbortController();


    const timer =
        setTimeout(
            () => controller.abort(),
            timeout
        );


    try {

        const response =
            await fetch(
                url.toString(),
                {
                    method: "GET",
                    mode: "cors",
                    signal:
                        controller.signal
                }
            );


        if (!response.ok) {

            throw new Error(
                "HTTP " +
                response.status
            );

        }


        const json =
            await response.json();


        if (json.error) {

            throw new Error(
                json.error.info ||
                "Wiki API error"
            );

        }


        return json;

    } catch (error) {

        if (
            error.name ===
            "AbortError"
        ) {

            throw new Error(
                "Wiki APIの応答が12秒以内にありませんでした。"
            );

        }


        throw error;

    } finally {

        clearTimeout(timer);

    }

}


/* =========================================================
   PARSE WIKI HTML
========================================================= */

async function getParsedHTML(
    page
) {

    const data =
        await wikiAPI({

            action: "parse",

            page: page,

            prop: "text",

            disablelimitreport:
                "1",

            disableeditsection:
                "1"

        });


    const raw =
        data?.parse?.text;


    if (
        typeof raw ===
        "string"
    ) {

        return raw;

    }


    if (
        raw &&
        typeof raw["*"] ===
        "string"
    ) {

        return raw["*"];

    }


    throw new Error(
        "WikiページのHTMLを取得できませんでした。"
    );

}


/* =========================================================
   WEAPON LIST PARSER
========================================================= */

function parseWeaponIndex(
    html
) {

    const parser =
        new DOMParser();


    const doc =
        parser.parseFromString(
            html,
            "text/html"
        );


    const tables =
        Array.from(
            doc.querySelectorAll(
                "table"
            )
        );


    let targetTable =
        tables.find(
            table => {

                const text =
                    cleanText(
                        table.textContent
                    ).toLowerCase();


                return (
                    text.includes("main") &&
                    text.includes("class")
                );

            }
        );


    if (!targetTable) {

        targetTable =
            tables.find(
                table =>
                    table.querySelectorAll(
                        "tr"
                    ).length > 20
            );

    }


    if (!targetTable) {

        throw new Error(
            "Wikiから武器一覧表を見つけられませんでした。"
        );

    }


    const result = [];


    const rows =
        Array.from(
            targetTable.querySelectorAll(
                "tr"
            )
        );


    rows.forEach(
        row => {

            const cells =
                Array.from(
                    row.children
                ).filter(
                    element =>
                        element.tagName ===
                            "TD" ||
                        element.tagName ===
                            "TH"
                );


            if (!cells.length) {
                return;
            }


            const link =
                Array.from(
                    row.querySelectorAll(
                        "a[href]"
                    )
                ).find(
                    anchor => {

                        const href =
                            anchor.getAttribute(
                                "href"
                            ) || "";


                        const text =
                            cleanText(
                                anchor.textContent
                            );


                        return (
                            href.startsWith(
                                "/wiki/"
                            ) &&
                            !href.includes(":") &&
                            text.length > 0 &&
                            text.length < 100
                        );

                    }
                );


            if (!link) {
                return;
            }


            const href =
                link.getAttribute(
                    "href"
                ) || "";


            const page =
                decodeURIComponent(
                    href.replace(
                        /^\/wiki\//,
                        ""
                    )
                );


            if (!page) {
                return;
            }


            const englishName =
                cleanText(
                    link.textContent
                );


            let category =
                "Other";


            for (
                const categoryName
                of CATEGORIES
            ) {

                const found =
                    cells.some(
                        cell =>
                            cleanText(
                                cell.textContent
                            ) ===
                            categoryName
                    );


                if (found) {

                    category =
                        categoryName;

                    break;

                }

            }


            const item = {

                id:
                    titleKey(page),

                page:
                    page,

                englishName:
                    englishName,

                japaneseName:
                    englishName,

                category:
                    category,

                image:
                    null

            };


            const duplicate =
                result.some(
                    weapon =>
                        weapon.id ===
                        item.id
                );


            if (!duplicate) {

                result.push(
                    item
                );

            }

        }
    );


    if (
        result.length < 20
    ) {

        throw new Error(
            "Wikiから取得した武器数が少なすぎます。Wikiのページ構成が変更された可能性があります。"
        );

    }


    return result;

}


/* =========================================================
   LOAD WEAPON INDEX
========================================================= */

async function loadWeaponIndex(
    force = false
) {

    if (!force) {

        const cached =
            loadCache(
                INDEX_CACHE_KEY,
                INDEX_CACHE_TIME
            );


        if (
            cached &&
            Array.isArray(cached)
        ) {

            weapons =
                cached;

            return weapons;

        }

    }


    setWikiStatus(
        "Wikiから武器一覧を取得中…"
    );


    const html =
        await getParsedHTML(
            WEAPON_LIST_PAGE
        );


    weapons =
        parseWeaponIndex(
            html
        );


    saveCache(
        INDEX_CACHE_KEY,
        weapons
    );


    return weapons;

}


/* =========================================================
   CHUNK
========================================================= */

function chunks(
    array,
    size
) {

    const result = [];


    for (
        let i = 0;
        i < array.length;
        i += size
    ) {

        result.push(
            array.slice(
                i,
                i + size
            )
        );

    }


    return result;

}


/* =========================================================
   LOAD WEAPON IMAGES
========================================================= */

async function loadWeaponImages() {

    if (!weapons.length) {
        return;
    }


    const batches =
        chunks(
            weapons,
            50
        );


    for (
        const batch
        of batches
    ) {

        try {

            const titles =
                batch
                    .map(
                        weapon =>
                            weapon.page
                    )
                    .join("|");


            const data =
                await wikiAPI({

                    action: "query",

                    prop: "pageimages",

                    piprop:
                        "thumbnail",

                    pithumbsize:
                        "220",

                    titles:
                        titles

                });


            const pages =
                data?.query?.pages;


            if (!pages) {
                continue;
            }


            const pageArray =
                Array.isArray(
                    pages
                )
                    ? pages
                    : Object.values(
                        pages
                    );


            pageArray.forEach(
                page => {

                    if (
                        !page.thumbnail ||
                        !page.thumbnail.source
                    ) {

                        return;

                    }


                    imageMap.set(
                        titleKey(
                            page.title
                        ),
                        page.thumbnail.source
                    );

                }
            );


        } catch (error) {

            console.warn(
                "Weapon image batch failed",
                error
            );

        }

    }


    weapons.forEach(
        weapon => {

            const image =
                imageMap.get(
                    titleKey(
                        weapon.page
                    )
                );


            if (image) {

                weapon.image =
                    image;

            }

        }
    );


    saveCache(
        INDEX_CACHE_KEY,
        weapons
    );


    renderWeaponList();

}


/* =========================================================
   CATEGORY UI
========================================================= */

function renderCategories() {

    const container =
        $("categoryList");


    container.innerHTML =
        "";


    const allButton =
        createCategoryButton(
            "all",
            "すべて"
        );


    allButton.classList.add(
        "active"
    );


    container.appendChild(
        allButton
    );


    CATEGORIES.forEach(
        category => {

            container.appendChild(
                createCategoryButton(
                    category,
                    CATEGORY_JA[
                        category
                    ] || category
                )
            );

        }
    );

}


/* =========================================================
   CREATE CATEGORY BUTTON
========================================================= */

function createCategoryButton(
    category,
    label
) {

    const button =
        document.createElement(
            "button"
        );


    button.type =
        "button";


    button.className =
        "category-button";


    button.dataset.category =
        category;


    button.textContent =
        label;


    button.addEventListener(
        "click",
        () => {

            selectedCategory =
                category;


            document
                .querySelectorAll(
                    ".category-button"
                )
                .forEach(
                    item => {

                        item.classList.toggle(
                            "active",
                            item.dataset.category ===
                            category
                        );

                    }
                );


            renderWeaponList();

        }
    );


    return button;

}


/* =========================================================
   WEAPON LIST
========================================================= */

function renderWeaponList() {

    const container =
        $("weaponList");


    const filtered =
        selectedCategory ===
        "all"

            ? weapons

            : weapons.filter(
                weapon =>
                    weapon.category ===
                    selectedCategory
            );


    $("weaponCount")
        .textContent =
        `（${filtered.length}）`;


    if (!filtered.length) {

        container.innerHTML =
            `
            <div class="side-loading">
                該当する武器がありません
            </div>
            `;

        return;

    }


    container.innerHTML =
        "";


    filtered.forEach(
        weapon => {

            const button =
                document.createElement(
                    "button"
                );


            button.type =
                "button";


            button.className =
                "weapon-item";


            button.dataset.id =
                weapon.id;


            if (
                selectedWeapon &&
                selectedWeapon.id ===
                weapon.id
            ) {

                button.classList.add(
                    "active"
                );

            }


            let imageHTML;


            if (weapon.image) {

                imageHTML =
                    `
                    <img
                        class="weapon-thumb"
                        src="${escapeHtml(
                            weapon.image
                        )}"
                        alt=""
                        loading="lazy"
                    >
                    `;

            } else {

                imageHTML =
                    `
                    <div class="weapon-thumb-placeholder">
                        WIKI
                    </div>
                    `;

            }


            button.innerHTML =
                `
                ${imageHTML}

                <div class="weapon-item-text">

                    <div class="weapon-name">
                        ${escapeHtml(
                            weapon.japaneseName ||
                            weapon.englishName
                        )}
                    </div>

                    <div class="weapon-name-en">
                        ${escapeHtml(
                            weapon.englishName
                        )}
                    </div>

                </div>
                `;


            button.addEventListener(
                "click",
                () => {

                    selectWeapon(
                        weapon
                    );

                }
            );


            container.appendChild(
                button
            );

        }
    );

}


/* =========================================================
   JAPANESE NAME
========================================================= */

function extractJapaneseName(
    doc
) {

    const headings =
        Array.from(
            doc.querySelectorAll(
                "h2, h3"
            )
        );


    const heading =
        headings.find(
            element =>
                /Names in other languages/i.test(
                    cleanText(
                        element.textContent
                    )
                )
        );


    if (!heading) {
        return null;
    }


    let current =
        heading.nextElementSibling;


    let guard = 0;


    while (
        current &&
        guard < 20
    ) {

        guard++;


        if (
            current.tagName ===
            "H2"
        ) {

            break;

        }


        if (
            current.tagName ===
            "TABLE"
        ) {

            const rows =
                Array.from(
                    current.querySelectorAll(
                        "tr"
                    )
                );


            for (
                const row
                of rows
            ) {

                const cells =
                    Array.from(
                        row.children
                    ).filter(
                        element =>
                            element.tagName ===
                                "TD" ||
                            element.tagName ===
                                "TH"
                    );


                if (
                    cells.length < 2
                ) {

                    continue;

                }


                const rowText =
                    cleanText(
                        row.textContent
                    );


                if (
                    /Japanese|Japan/i.test(
                        rowText
                    )
                ) {

                    const value =
                        cleanText(
                            cells[1]
                                .textContent
                        );


                    if (
                        value &&
                        value.length < 60
                    ) {

                        return value;

                    }

                }

            }

        }


        current =
            current.nextElementSibling;

    }


    return null;

}


/* =========================================================
   SPLATOON 3 SECTION
========================================================= */

function getSplatoon3Section(
    doc
) {

    const headings =
        Array.from(
            doc.querySelectorAll(
                "h2"
            )
        );


    const heading =
        headings.find(
            element => {

                return (
                    cleanText(
                        element.textContent
                    )
                        .replace(
                            /\[edit\]/gi,
                            ""
                        )
                        .trim()
                        .toLowerCase() ===
                    "splatoon 3"
                );

            }
        );


    if (!heading) {

        return doc.body;

    }


    const wrapper =
        document.createElement(
            "div"
        );


    let current =
        heading.nextElementSibling;


    let guard = 0;


    while (
        current &&
        guard < 100
    ) {

        guard++;


        if (
            current.tagName ===
            "H2"
        ) {

            break;

        }


        wrapper.appendChild(
            current.cloneNode(
                true
            )
        );


        current =
            current.nextElementSibling;

    }


    return wrapper;

}


/* =========================================================
   TABLE VALUE
========================================================= */

function findTableValue(
    root,
    labels
) {

    const wanted =
        labels.map(
            label =>
                cleanText(
                    label
                ).toLowerCase()
        );


    const rows =
        Array.from(
            root.querySelectorAll(
                "tr"
            )
        );


    for (
        const row
        of rows
    ) {

        const cells =
            Array.from(
                row.children
            ).filter(
                element =>
                    element.tagName ===
                        "TD" ||
                    element.tagName ===
                        "TH"
            );


        if (
            cells.length < 2
        ) {

            continue;

        }


        const first =
            cleanText(
                cells[0].textContent
            )
                .toLowerCase();


        const matched =
            wanted.some(
                label =>
                    first === label ||
                    first.startsWith(
                        label
                    )
            );


        if (!matched) {
            continue;
        }


        return cleanText(
            cells[
                cells.length - 1
            ].textContent
        );

    }


    return null;

}


/* =========================================================
   NUMBER PARSERS
========================================================= */

function parseStat100(
    value
) {

    if (!value) {
        return null;
    }


    const match =
        value.match(
            /(\d+(?:\.\d+)?)\s*\/\s*100/
        );


    if (!match) {
        return null;
    }


    return Number(
        match[1]
    );

}


function firstNumber(
    value
) {

    if (!value) {
        return null;
    }


    const match =
        String(value).match(
            /-?\d+(?:\.\d+)?/
        );


    return match
        ? Number(match[0])
        : null;

}


/* =========================================================
   DETAIL PARSER
========================================================= */

function parseWeaponDetail(
    html,
    weapon
) {

    const parser =
        new DOMParser();


    const doc =
        parser.parseFromString(
            html,
            "text/html"
        );


    const section =
        getSplatoon3Section(
            doc
        );


    const sectionText =
        cleanText(
            section.textContent
        );


    const basicRangeText =
        findTableValue(
            section,
            ["Range"]
        );


    const basicDamageText =
        findTableValue(
            section,
            ["Damage"]
        );


    const baseDamageText =
        findTableValue(
            section,
            [
                "Base damage",
                "Base Damage"
            ]
        );


    const minimumDamageText =
        findTableValue(
            section,
            [
                "Minimum damage",
                "Minimum Damage"
            ]
        );


    const effectiveRangeText =
        findTableValue(
            section,
            [
                "Effective range",
                "Effective Range"
            ]
        );


    const inkConsumptionText =
        findTableValue(
            section,
            [
                "Ink consumption",
                "Ink Consumption"
            ]
        );


    const specialPointsText =
        findTableValue(
            section,
            [
                "Special points",
                "Special Points"
            ]
        );


    const subText =
        findTableValue(
            section,
            ["Sub"]
        );


    const specialText =
        findTableValue(
            section,
            ["Special"]
        );


    const rangeStat =
        parseStat100(
            basicRangeText
        );


    const damageStat =
        parseStat100(
            basicDamageText
        );


    let baseDamage =
        firstNumber(
            baseDamageText
        );


    let minimumDamage =
        firstNumber(
            minimumDamageText
        );


    let effectiveRange =
        firstNumber(
            effectiveRangeText
        );


    const inkConsumption =
        inkConsumptionText;


    const specialPoints =
        firstNumber(
            specialPointsText
        );


    /* =====================================================
       BASE DAMAGE
    ===================================================== */

    if (
        baseDamage === null
    ) {

        const match =
            sectionText.match(
                /base damage(?: is| of)?\s*(\d+(?:\.\d+)?)/i
            );


        if (match) {

            baseDamage =
                Number(
                    match[1]
                );

        }

    }


    /* =====================================================
       MINIMUM DAMAGE
    ===================================================== */

    if (
        minimumDamage === null
    ) {

        const match =
            sectionText.match(
                /minimum damage(?: is| of)?\s*(\d+(?:\.\d+)?)/i
            );


        if (match) {

            minimumDamage =
                Number(
                    match[1]
                );

        }

    }


    /* =====================================================
       EFFECTIVE RANGE
    ===================================================== */

    if (
        effectiveRange === null
    ) {

        const match =
            sectionText.match(
                /effective range(?: is| of|:)?\s*(?:about\s*)?(\d+(?:\.\d+)?)\s*(?:units)?/i
            );


        if (match) {

            effectiveRange =
                Number(
                    match[1]
                );

        }

    }


    /* =====================================================
       STRAIGHT DISTANCE
    ===================================================== */

    let straightDistance =
        null;


    const straightPatterns = [

        /travel straight for\s*(\d+(?:\.\d+)?)\s*(?:distance\s*)?units/i,

        /straight(?:-line)? distance(?: is| of)?\s*(\d+(?:\.\d+)?)/i,

        /directly for\s*(\d+(?:\.\d+)?)\s*units/i

    ];


    for (
        const pattern
        of straightPatterns
    ) {

        const match =
            sectionText.match(
                pattern
            );


        if (match) {

            straightDistance =
                Number(
                    match[1]
                );

            break;

        }

    }


    /* =====================================================
       DAMAGE DECAY
    ===================================================== */

    let decayPerFrame =
        null;


    const decayPatterns = [

        /decreases by\s*(\d+(?:\.\d+)?)\s*damage per frame/i,

        /decreases\s*(\d+(?:\.\d+)?)\s*damage every frame/i,

        /loses\s*(\d+(?:\.\d+)?)\s*damage every frame/i,

        /damage decreases by\s*(\d+(?:\.\d+)?)\s*per frame/i

    ];


    for (
        const pattern
        of decayPatterns
    ) {

        const match =
            sectionText.match(
                pattern
            );


        if (match) {

            decayPerFrame =
                Number(
                    match[1]
                );

            break;

        }

    }


    /* =====================================================
       MINIMUM DAMAGE FRAME
    ===================================================== */

    let minimumAtFrame =
        null;


    const framePatterns = [

        /reaches\s*\d+(?:\.\d+)?\s*damage at frame\s*(\d+)/i,

        /until.*?frame\s*(\d+)/i

    ];


    for (
        const pattern
        of framePatterns
    ) {

        const match =
            sectionText.match(
                pattern
            );


        if (match) {

            minimumAtFrame =
                Number(
                    match[1]
                );

            break;

        }

    }


    /* =====================================================
       FIRE RATE
    ===================================================== */

    let fireRateFrames =
        null;


    const fireRateMatch =
        sectionText.match(
            /every\s*(\d+(?:\.\d+)?)\s*frames/i
        );


    if (fireRateMatch) {

        fireRateFrames =
            Number(
                fireRateMatch[1]
            );

    }


    let shotsPerSecond =
        null;


    if (
        fireRateFrames &&
        fireRateFrames > 0
    ) {

        shotsPerSecond =
            60 /
            fireRateFrames;

    }


    /* =====================================================
       DIRECT DAMAGE
    ===================================================== */

    let directDamage =
        null;


    const directPatterns = [

        /direct hit.*?(\d+(?:\.\d+)?)\s*damage/i,

        /damage on direct hit.*?(\d+(?:\.\d+)?)/i,

        /directly hit.*?(\d+(?:\.\d+)?)\s*damage/i

    ];


    for (
        const pattern
        of directPatterns
    ) {

        const match =
            sectionText.match(
                pattern
            );


        if (match) {

            directDamage =
                Number(
                    match[1]
                );

            break;

        }

    }


    /* =====================================================
       BLAST
    ===================================================== */

    let nearBlastRadius =
        null;

    let fullBlastRadius =
        null;

    let nearBlastDamage =
        null;

    let farBlastDamage =
        null;


    const nearPatterns = [

        /near blast radius.*?(\d+(?:\.\d+)?)\s*(?:units)?/i,

        /near damage radius.*?(\d+(?:\.\d+)?)\s*(?:units)?/i,

        /70 damage radius.*?(\d+(?:\.\d+)?)\s*(?:units)?/i

    ];


    for (
        const pattern
        of nearPatterns
    ) {

        const match =
            sectionText.match(
                pattern
            );


        if (match) {

            nearBlastRadius =
                Number(
                    match[1]
                );

            break;

        }

    }


    const fullPatterns = [

        /full blast radius.*?(\d+(?:\.\d+)?)\s*(?:units)?/i,

        /full damage radius.*?(\d+(?:\.\d+)?)\s*(?:units)?/i,

        /50 damage radius.*?(\d+(?:\.\d+)?)\s*(?:units)?/i

    ];


    for (
        const pattern
        of fullPatterns
    ) {

        const match =
            sectionText.match(
                pattern
            );


        if (match) {

            fullBlastRadius =
                Number(
                    match[1]
                );

            break;

        }

    }


    const damageRangeMatch =
        sectionText.match(
            /between\s*(\d+(?:\.\d+)?)\s*and\s*(\d+(?:\.\d+)?)\s*damage/i
        );


    if (damageRangeMatch) {

        nearBlastDamage =
            Number(
                damageRangeMatch[1]
            );


        farBlastDamage =
            Number(
                damageRangeMatch[2]
            );

    }


    if (
        nearBlastDamage === null
    ) {

        const match =
            sectionText.match(
                /always take\s*(\d+(?:\.\d+)?)\s*damage/i
            );


        if (match) {

            nearBlastDamage =
                Number(
                    match[1]
                );

        }

    }


    /* =====================================================
       DESCRIPTION
    ===================================================== */

    let description =
        "";


    const paragraphs =
        Array.from(
            section.querySelectorAll(
                "p"
            )
        );


    for (
        const paragraph
        of paragraphs
    ) {

        const text =
            cleanText(
                paragraph.textContent
            );


        if (
            text.length > 40 &&
            text.length < 500
        ) {

            description =
                text;

            break;

        }

    }


    /* =====================================================
       JAPANESE NAME
    ===================================================== */

    const japaneseName =
        extractJapaneseName(
            doc
        );


    /* =====================================================
       IMAGE
    ===================================================== */

    const image =
        extractWeaponImage(
            doc,
            weapon
        );


    /* =====================================================
       RESULT
    ===================================================== */

    return {

        ...weapon,

        japaneseName:
            japaneseName ||
            weapon.japaneseName ||
            weapon.englishName,

        image:
            image ||
            weapon.image ||
            null,

        rangeStat,

        damageStat,

        baseDamage,

        minimumDamage,

        effectiveRange,

        straightDistance,

        decayPerFrame,

        minimumAtFrame,

        fireRateFrames,

        shotsPerSecond,

        directDamage,

        nearBlastRadius,

        fullBlastRadius,

        nearBlastDamage,

        farBlastDamage,

        inkConsumption,

        specialPoints,

        sub:
            subText,

        special:
            specialText,

        description,

        sourceText:
            sectionText

    };

}


/* =========================================================
   IMAGE EXTRACTION
========================================================= */

function normalizeImageUrl(
    src
) {

    if (!src) {
        return null;
    }


    src =
        String(src).trim();


    if (
        src.startsWith("//")
    ) {

        return (
            "https:" +
            src
        );

    }


    if (
        src.startsWith("/")
    ) {

        return (
            "https://splatoonwiki.org" +
            src
        );

    }


    return src;

}


function extractWeaponImage(
    doc,
    weapon
) {

    const images =
        Array.from(
            doc.querySelectorAll(
                "img"
            )
        );


    const weaponName =
        (
            weapon.englishName ||
            ""
        )
            .toLowerCase();


    const compactName =
        weaponName.replace(
            /[^a-z0-9]/g,
            ""
        );


    let best =
        null;


    let bestScore =
        -Infinity;


    images.forEach(
        img => {

            const src =
                img.getAttribute(
                    "src"
                ) ||
                img.getAttribute(
                    "data-src"
                );


            const url =
                normalizeImageUrl(
                    src
                );


            if (!url) {
                return;
            }


            const alt =
                cleanText(
                    img.getAttribute(
                        "alt"
                    )
                ).toLowerCase();


            const title =
                cleanText(
                    img.getAttribute(
                        "title"
                    )
                ).toLowerCase();


            const parent =
                img.closest(
                    "a"
                );


            const href =
                parent
                    ? (
                        parent.getAttribute(
                            "href"
                        ) || ""
                    ).toLowerCase()
                    : "";


            const fileInfo =
                href +
                " " +
                src.toLowerCase();


            let score = 0;


            if (
                alt.includes(
                    weaponName
                )
            ) {

                score += 20;

            }


            if (
                title.includes(
                    weaponName
                )
            ) {

                score += 20;

            }


            const compactFile =
                fileInfo.replace(
                    /[^a-z0-9]/g,
                    ""
                );


            if (
                compactName &&
                compactFile.includes(
                    compactName
                )
            ) {

                score += 15;

            }


            if (
                fileInfo.includes(
                    "weapon"
                )
            ) {

                score += 5;

            }


            if (
                fileInfo.includes(
                    "icon"
                )
            ) {

                score += 5;

            }


            if (
                fileInfo.includes(
                    "promo"
                )
            ) {

                score -= 8;

            }


            if (
                fileInfo.includes(
                    "screenshot"
                )
            ) {

                score -= 8;

            }


            if (
                fileInfo.includes(
                    "logo"
                )
            ) {

                score -= 20;

            }


            const width =
                Number(
                    img.getAttribute(
                        "width"
                    )
                );


            const height =
                Number(
                    img.getAttribute(
                        "height"
                    )
                );


            if (
                width &&
                height &&
                width < 40 &&
                height < 40
            ) {

                score -= 15;

            }


            if (
                score >
                bestScore
            ) {

                bestScore =
                    score;

                best =
                    url;

            }

        }
    );


    return (
        bestScore > 0
            ? best
            : null
    );

}


/* =========================================================
   LOAD WEAPON DETAIL
========================================================= */

async function loadWeaponDetail(
    weapon
) {

    const cacheKey =
        CACHE_PREFIX +
        "detail_" +
        weapon.id;


    const cached =
        loadCache(
            cacheKey,
            DETAIL_CACHE_TIME
        );


    if (cached) {

        return cached;

    }


    const html =
        await getParsedHTML(
            weapon.page
        );


    const detail =
        parseWeaponDetail(
            html,
            weapon
        );


    saveCache(
        cacheKey,
        detail
    );


    return detail;

}


/* =========================================================
   SELECT WEAPON
========================================================= */

async function selectWeapon(
    weapon
) {

    selectedWeapon =
        weapon;


    renderWeaponList();


    showMainLoading();


    hideError();


    try {

        const detail =
            await loadWeaponDetail(
                weapon
            );


        selectedWeapon =
            detail;


        renderWeaponDetail(
            detail
        );


        hideMainLoading();


        $("weaponContent")
            .classList.remove(
                "hidden"
            );


        setWikiStatus(
            "Wikiデータ取得済み",
            "ok"
        );


    } catch (error) {

        console.error(
            error
        );


        hideMainLoading();


        $("weaponContent")
            .classList.add(
                "hidden"
            );


        showError(
            error.message ||
            "武器データの取得に失敗しました。"
        );


        setWikiStatus(
            "Wiki接続エラー",
            "error"
        );

    }

}


/* =========================================================
   RENDER WEAPON DETAIL
========================================================= */

function renderWeaponDetail(
    data
) {

    $("weaponJapaneseName")
        .textContent =
        data.japaneseName ||
        data.englishName ||
        "—";


    $("weaponEnglishName")
        .textContent =
        data.englishName ||
        "—";


    $("weaponCategory")
        .textContent =
        CATEGORY_JA[
            data.category
        ] ||
        data.category ||
        "—";


    $("weaponDescription")
        .textContent =
        data.description ||
        "Wiki掲載の詳細データを表示しています。";


    $("weaponSub")
        .textContent =
        data.sub ||
        "—";


    $("weaponSpecial")
        .textContent =
        data.special ||
        "—";


    $("basicRange")
        .textContent =
        data.rangeStat !== null &&
        data.rangeStat !== undefined
            ? `${data.rangeStat} / 100`
            : "—";


    $("basicDamage")
        .textContent =
        data.damageStat !== null &&
        data.damageStat !== undefined
            ? `${data.damageStat} / 100`
            : "—";


    $("basicBaseDamage")
        .textContent =
        valueOrDash(
            data.baseDamage
        );


    $("basicMinDamage")
        .textContent =
        valueOrDash(
            data.minimumDamage
        );


    $("basicEffectiveRange")
        .textContent =
        data.effectiveRange !== null &&
        data.effectiveRange !== undefined
            ? `${data.effectiveRange} units`
            : "—";


    $("basicSP")
        .textContent =
        valueOrDash(
            data.specialPoints
        );


    renderWeaponImage(
        data
    );


    renderRange(
        data
    );


    renderBlast(
        data
    );


    renderDamageChart(
        data
    );


    renderDecayChart(
        data
    );


    renderSpecifications(
        data
    );


    $("wikiLink").href =
        "https://splatoonwiki.org/wiki/" +
        encodeURIComponent(
            data.page
        ).replace(
            /%2F/g,
            "/"
        );

}


/* =========================================================
   RENDER IMAGE
========================================================= */

function renderWeaponImage(
    data
) {

    const image =
        $("weaponImage");


    const placeholder =
        $("weaponImagePlaceholder");


    if (data.image) {

        image.src =
            data.image;


        image.alt =
            data.japaneseName ||
            data.englishName;


        image.classList.remove(
            "hidden"
        );


        placeholder.classList.add(
            "hidden"
        );

    } else {

        image.src =
            "";


        image.classList.add(
            "hidden"
        );


        placeholder.classList.remove(
            "hidden"
        );

    }

}


/* =========================================================
   RANGE
========================================================= */

function renderRange(
    data
) {

    const value =
        Number(
            data.rangeStat
        );


    const percent =
        Number.isFinite(
            value
        )
            ? Math.max(
                0,
                Math.min(
                    100,
                    value
                )
            )
            : 0;


    $("rangeFill")
        .style.width =
        percent + "%";


    $("rangeEnd")
        .style.left =
        percent + "%";


    $("rangeValue")
        .textContent =
        Number.isFinite(
            value
        )
            ? `${value} / 100`
            : "—";


    $("effectiveRangeBox")
        .textContent =
        data.effectiveRange !== null &&
        data.effectiveRange !== undefined
            ? `詳細有効射程：${data.effectiveRange} units`
            : "詳細有効射程：Wiki掲載なし";

}


/* =========================================================
   BLAST RADIUS
========================================================= */

function renderBlast(
    data
) {

    const near =
        Number(
            data.nearBlastRadius
        );


    const full =
        Number(
            data.fullBlastRadius
        );


    const nearCircle =
        $("blastNearCircle");


    const fullCircle =
        $("blastFullCircle");


    if (
        !Number.isFinite(full) ||
        full <= 0
    ) {

        nearCircle.style.width =
            "0px";


        nearCircle.style.height =
            "0px";


        fullCircle.style.width =
            "0px";


        fullCircle.style.height =
            "0px";


        $("blastInfo")
            .textContent =
            "爆風なし";


        return;

    }


    const maxRadius =
        78;


    const scale =
        maxRadius /
        full;


    const fullPx =
        Math.min(
            78,
            full * scale
        );


    fullCircle.style.width =
        fullPx * 2 + "px";


    fullCircle.style.height =
        fullPx * 2 + "px";


    if (
        Number.isFinite(near) &&
        near > 0
    ) {

        const nearPx =
            Math.min(
                fullPx,
                near * scale
            );


        nearCircle.style.width =
            nearPx * 2 + "px";


        nearCircle.style.height =
            nearPx * 2 + "px";

    } else {

        nearCircle.style.width =
            "0px";


        nearCircle.style.height =
            "0px";

    }


    const damageText =
        data.nearBlastDamage !== null &&
        data.nearBlastDamage !== undefined

            ? `${data.nearBlastDamage} → ${
                data.farBlastDamage ??
                data.nearBlastDamage
            } damage`

            : "ダメージ情報あり";


    $("blastInfo")
        .textContent =
        `近距離爆風：${
            Number.isFinite(
                near
            )
                ? near + " units"
                : "—"
        } ｜ 全爆風：${
            full + " units"
        } ｜ ${damageText}`;

}


/* =========================================================
   SVG
========================================================= */

function svgElement(
    tag,
    attrs = {}
) {

    const element =
        document.createElementNS(
            "http://www.w3.org/2000/svg",
            tag
        );


    Object.entries(
        attrs
    ).forEach(
        ([key, value]) => {

            element.setAttribute(
                key,
                value
            );

        }
    );


    return element;

}


function addSvgText(
    svg,
    text,
    x,
    y,
    options = {}
) {

    const node =
        svgElement(
            "text",
            {
                x,
                y,

                fill:
                    options.fill ||
                    "#8ea2bb",

                "font-size":
                    options.size ||
                    "10",

                "font-weight":
                    options.weight ||
                    "600",

                "text-anchor":
                    options.anchor ||
                    "start"

            }
        );


    node.textContent =
        text;


    svg.appendChild(
        node
    );


    return node;

}


/* =========================================================
   DAMAGE GRAPH
========================================================= */

function renderDamageChart(
    data
) {

    const container =
        $("damageChart");


    container.innerHTML =
        "";


    const width =
        Math.max(
            320,
            container.clientWidth
        );


    const height =
        225;


    const svg =
        svgElement(
            "svg",
            {
                viewBox:
                    `0 0 ${width} ${height}`,

                class:
                    "chart-svg",

                preserveAspectRatio:
                    "none"

            }
        );


    const left = 42;

    const right =
        width - 15;

    const top = 15;

    const bottom =
        height - 32;


    const plotWidth =
        right - left;

    const plotHeight =
        bottom - top;


    /* =====================================================
       BLASTER
    ===================================================== */

    if (
        Number.isFinite(
            data.fullBlastRadius
        ) &&
        Number.isFinite(
            data.nearBlastDamage
        )
    ) {

        const maxX =
            data.fullBlastRadius;


        const high =
            Math.max(
                data.directDamage || 0,
                data.nearBlastDamage,
                data.farBlastDamage || 0,
                1
            );


        const nearDamage =
            data.nearBlastDamage;


        const farDamage =
            Number.isFinite(
                data.farBlastDamage
            )
                ? data.farBlastDamage
                : nearDamage;


        drawAxes(
            svg,
            left,
            right,
            top,
            bottom,
            0,
            maxX,
            0,
            high
        );


        const points = [];


        for (
            let i = 0;
            i <= 40;
            i++
        ) {

            const x =
                maxX *
                i /
                40;


            let damage;


            if (
                x === 0 &&
                Number.isFinite(
                    data.directDamage
                )
            ) {

                damage =
                    data.directDamage;

            } else if (
                x <=
                (
                    data.nearBlastRadius ||
                    maxX
                )
            ) {

                damage =
                    nearDamage;

            } else {

                const start =
                    data.nearBlastRadius ||
                    0;


                const ratio =
                    (
                        x - start
                    ) /
                    (
                        maxX - start
                    );


                damage =
                    nearDamage +
                    (
                        farDamage -
                        nearDamage
                    ) *
                    Math.max(
                        0,
                        Math.min(
                            1,
                            ratio
                        )
                    );

            }


            const px =
                left +
                (
                    x / maxX
                ) *
                plotWidth;


            const py =
                bottom -
                (
                    damage / high
                ) *
                plotHeight;


            points.push(
                `${px},${py}`
            );

        }


        const line =
            svgElement(
                "polyline",
                {
                    points:
                        points.join(" "),

                    fill:
                        "none",

                    stroke:
                        "#a43cff",

                    "stroke-width":
                        "3",

                    "stroke-linecap":
                        "round",

                    "stroke-linejoin":
                        "round"

                }
            );


        svg.appendChild(
            line
        );


        addSvgText(
            svg,
            "爆発中心からの距離",
            right,
            height - 7,
            {
                anchor: "end",
                size: "9"
            }
        );


        $("damageNote")
            .textContent =
            "ブラスター：Wiki掲載の直撃・近距離爆風・遠距離爆風値を使用。";

    }

    /* =====================================================
       NORMAL WEAPON
    ===================================================== */

    else if (
        Number.isFinite(
            data.baseDamage
        ) &&
        Number.isFinite(
            data.minimumDamage
        ) &&
        Number.isFinite(
            data.effectiveRange
        ) &&
        data.effectiveRange > 0
    ) {

        const maxX =
            data.effectiveRange;


        const maxDamage =
            Math.max(
                data.baseDamage,
                data.minimumDamage,
                1
            );


        drawAxes(
            svg,
            left,
            right,
            top,
            bottom,
            0,
            maxX,
            0,
            maxDamage
        );


        const points = [];


        for (
            let i = 0;
            i <= 40;
            i++
        ) {

            const x =
                maxX *
                i /
                40;


            let damage;


            if (
                Number.isFinite(
                    data.straightDistance
                ) &&
                x <=
                data.straightDistance
            ) {

                damage =
                    data.baseDamage;

            } else {

                const start =
                    Number.isFinite(
                        data.straightDistance
                    )
                        ? data.straightDistance
                        : 0;


                const ratio =
                    (
                        x - start
                    ) /
                    (
                        maxX - start
                    );


                damage =
                    data.baseDamage -
                    (
                        data.baseDamage -
                        data.minimumDamage
                    ) *
                    Math.max(
                        0,
                        Math.min(
                            1,
                            ratio
                        )
                    );

            }


            const px =
                left +
                (
                    x / maxX
                ) *
                plotWidth;


            const py =
                bottom -
                (
                    damage / maxDamage
                ) *
                plotHeight;


            points.push(
                `${px},${py}`
            );

        }


        const area =
            svgElement(
                "polygon",
                {
                    points:
                        `${left},${bottom} ` +
                        points.join(" ") +
                        ` ${right},${bottom}`,

                    fill:
                        "rgba(153,61,255,0.10)"

                }
            );


        svg.appendChild(
            area
        );


        const line =
            svgElement(
                "polyline",
                {
                    points:
                        points.join(" "),

                    fill:
                        "none",

                    stroke:
                        "#a43cff",

                    "stroke-width":
                        "3",

                    "stroke-linecap":
                        "round",

                    "stroke-linejoin":
                        "round"

                }
            );


        svg.appendChild(
            line
        );


        addSvgText(
            svg,
            "距離",
            right,
            height - 7,
            {
                anchor: "end",
                size: "9"
            }
        );


        $("damageNote")
            .textContent =
            "Wiki掲載の基礎ダメージ・最小ダメージ・有効射程を使用。詳細点がない部分は視覚補間。";

    }

    else {

        container.innerHTML =
            `
            <div class="chart-empty">
                この武器ではWikiから十分な距離別ダメージ値を取得できません。
            </div>
            `;


        $("damageNote")
            .textContent =
            "";


        return;

    }


    container.appendChild(
        svg
    );

}


/* =========================================================
   DAMAGE DECAY GRAPH
========================================================= */

function renderDecayChart(
    data
) {

    const container =
        $("decayChart");


    container.innerHTML =
        "";


    const width =
        Math.max(
            320,
            container.clientWidth
        );


    const height =
        225;


    const svg =
        svgElement(
            "svg",
            {
                viewBox:
                    `0 0 ${width} ${height}`,

                class:
                    "chart-svg",

                preserveAspectRatio:
                    "none"

            }
        );


    const left = 42;

    const right =
        width - 15;

    const top = 15;

    const bottom =
        height - 32;


    const plotWidth =
        right - left;

    const plotHeight =
        bottom - top;


    /* =====================================================
       BLASTER
    ===================================================== */

    if (
        Number.isFinite(
            data.fullBlastRadius
        ) &&
        Number.isFinite(
            data.nearBlastDamage
        )
    ) {

        const maxX =
            data.fullBlastRadius;


        const maxDamage =
            Math.max(
                data.directDamage || 0,
                data.nearBlastDamage,
                data.farBlastDamage || 0,
                1
            );


        drawAxes(
            svg,
            left,
            right,
            top,
            bottom,
            0,
            maxX,
            0,
            maxDamage
        );


        const points = [];


        for (
            let i = 0;
            i <= 40;
            i++
        ) {

            const x =
                maxX *
                i /
                40;


            let damage;


            if (
                x === 0 &&
                Number.isFinite(
                    data.directDamage
                )
            ) {

                damage =
                    data.directDamage;

            } else if (
                x <=
                (
                    data.nearBlastRadius ||
                    maxX
                )
            ) {

                damage =
                    data.nearBlastDamage;

            } else {

                const start =
                    data.nearBlastRadius ||
                    0;


                const ratio =
                    (
                        x - start
                    ) /
                    (
                        maxX - start
                    );


                damage =
                    data.nearBlastDamage +
                    (
                        (
                            data.farBlastDamage ??
                            data.nearBlastDamage
                        ) -
                        data.nearBlastDamage
                    ) *
                    Math.max(
                        0,
                        Math.min(
                            1,
                            ratio
                        )
                    );

            }


            const px =
                left +
                (
                    x / maxX
                ) *
                plotWidth;


            const py =
                bottom -
                (
                    damage / maxDamage
                ) *
                plotHeight;


            points.push(
                `${px},${py}`
            );

        }


        const line =
            svgElement(
                "polyline",
                {
                    points:
                        points.join(" "),

                    fill:
                        "none",

                    stroke:
                        "#ed3471",

                    "stroke-width":
                        "3",

                    "stroke-linecap":
                        "round",

                    "stroke-linejoin":
                        "round"

                }
            );


        svg.appendChild(
            line
        );


        $("decayNote")
            .textContent =
            "ブラスターは爆発中心からの距離による爆風ダメージ変化を表示。";

    }

    /* =====================================================
       NORMAL WEAPON
    ===================================================== */

    else if (
        Number.isFinite(
            data.baseDamage
        ) &&
        Number.isFinite(
            data.minimumDamage
        ) &&
        Number.isFinite(
            data.effectiveRange
        )
    ) {

        const maxX =
            data.effectiveRange;


        const maxDamage =
            Math.max(
                data.baseDamage,
                1
            );


        drawAxes(
            svg,
            left,
            right,
            top,
            bottom,
            0,
            maxX,
            0,
            maxDamage
        );


        const points = [];


        for (
            let i = 0;
            i <= 40;
            i++
        ) {

            const x =
                maxX *
                i /
                40;


            let damage;


            if (
                Number.isFinite(
                    data.straightDistance
                ) &&
                x <=
                data.straightDistance
            ) {

                damage =
                    data.baseDamage;

            } else {

                const start =
                    Number.isFinite(
                        data.straightDistance
                    )
                        ? data.straightDistance
                        : 0;


                const ratio =
                    (
                        x - start
                    ) /
                    (
                        maxX - start
                    );


                damage =
                    data.baseDamage -
                    (
                        data.baseDamage -
                        data.minimumDamage
                    ) *
                    Math.max(
                        0,
                        Math.min(
                            1,
                            ratio
                        )
                    );

            }


            const px =
                left +
                (
                    x / maxX
                ) *
                plotWidth;


            const py =
                bottom -
                (
                    damage / maxDamage
                ) *
                plotHeight;


            points.push(
                `${px},${py}`
            );

        }


        const line =
            svgElement(
                "polyline",
                {
                    points:
                        points.join(" "),

                    fill:
                        "none",

                    stroke:
                        "#a43cff",

                    "stroke-width":
                        "3",

                    "stroke-linecap":
                        "round",

                    "stroke-linejoin":
                        "round"

                }
            );


        svg.appendChild(
            line
        );


        $("decayNote")
            .textContent =
            data.decayPerFrame !== null
                ? `Wiki記載の距離減衰：${data.decayPerFrame} damage / frame`
                : "Wiki掲載値からダメージ減衰を視覚化。";

    }

    else {

        container.innerHTML =
            `
            <div class="chart-empty">
                この武器では距離減衰の詳細値を取得できません。
            </div>
            `;


        $("decayNote")
            .textContent =
            "";


        return;

    }


    container.appendChild(
        svg
    );

}


/* =========================================================
   AXES
========================================================= */

function drawAxes(
    svg,
    left,
    right,
    top,
    bottom,
    minX,
    maxX,
    minY,
    maxY
) {

    const width =
        right - left;

    const height =
        bottom - top;


    for (
        let i = 0;
        i <= 4;
        i++
    ) {

        const y =
            bottom -
            height *
            i /
            4;


        const line =
            svgElement(
                "line",
                {
                    x1: left,
                    y1: y,
                    x2: right,
                    y2: y,

                    stroke:
                        "#18304b",

                    "stroke-width":
                        "1"

                }
            );


        svg.appendChild(
            line
        );


        const value =
            minY +
            (
                maxY - minY
            ) *
            i /
            4;


        addSvgText(
            svg,
            formatNumber(
                value
            ),
            left - 7,
            y + 3,
            {
                anchor: "end",
                size: "8"
            }
        );

    }


    for (
        let i = 0;
        i <= 4;
        i++
    ) {

        const x =
            left +
            width *
            i /
            4;


        const line =
            svgElement(
                "line",
                {
                    x1: x,
                    y1: top,
                    x2: x,
                    y2: bottom,

                    stroke:
                        "#122942",

                    "stroke-width":
                        "1"

                }
            );


        svg.appendChild(
            line
        );


        const value =
            minX +
            (
                maxX - minX
            ) *
            i /
            4;


        addSvgText(
            svg,
            formatNumber(
                value
            ),
            x,
            bottom + 15,
            {
                anchor: "middle",
                size: "8"
            }
        );

    }

}


/* =========================================================
   SPECIFICATIONS
========================================================= */

function renderSpecifications(
    data
) {

    const container =
        $("specifications");


    const specs = [

        [
            "射程ステータス",

            data.rangeStat !== null &&
            data.rangeStat !== undefined

                ? `${data.rangeStat} / 100`

                : null
        ],

        [
            "ダメージステータス",

            data.damageStat !== null &&
            data.damageStat !== undefined

                ? `${data.damageStat} / 100`

                : null
        ],

        [
            "基礎ダメージ",
            data.baseDamage
        ],

        [
            "最小ダメージ",
            data.minimumDamage
        ],

        [
            "有効射程",

            Number.isFinite(
                data.effectiveRange
            )
                ? `${data.effectiveRange} units`
                : null
        ],

        [
            "直線飛翔距離",

            Number.isFinite(
                data.straightDistance
            )
                ? `${data.straightDistance} units`
                : null
        ],

        [
            "近距離爆風半径",

            Number.isFinite(
                data.nearBlastRadius
            )
                ? `${data.nearBlastRadius} units`
                : null
        ],

        [
            "全爆風半径",

            Number.isFinite(
                data.fullBlastRadius
            )
                ? `${data.fullBlastRadius} units`
                : null
        ],

        [
            "爆風ダメージ",

            data.nearBlastDamage !== null &&
            data.nearBlastDamage !== undefined

                ? `${data.nearBlastDamage} → ${
                    data.farBlastDamage ??
                    data.nearBlastDamage
                }`

                : null
        ],

        [
            "発射間隔",

            Number.isFinite(
                data.fireRateFrames
            )
                ? `${data.fireRateFrames} frames`
                : null
        ],

        [
            "毎秒発射数",

            Number.isFinite(
                data.shotsPerSecond
            )
                ? `${data.shotsPerSecond.toFixed(2)} shots/s`
                : null
        ],

        [
            "インク消費",
            data.inkConsumption
        ],

        [
            "SP必要ポイント",
            data.specialPoints
        ],

        [
            "サブ",
            data.sub
        ],

        [
            "スペシャル",
            data.special
        ]

    ];


    container.innerHTML =
        "";


    specs.forEach(
        ([label, value]) => {

            if (
                value === null ||
                value === undefined ||
                value === ""
            ) {

                return;

            }


            const item =
                document.createElement(
                    "div"
                );


            item.className =
                "spec-item";


            item.innerHTML =
                `
                <div class="spec-label">
                    ${escapeHtml(label)}
                </div>

                <div class="spec-value">
                    ${escapeHtml(
                        valueOrDash(
                            value
                        )
                    )}
                </div>
                `;


            container.appendChild(
                item
            );

        }
    );

}


/* =========================================================
   VALUE HELPERS
========================================================= */

function valueOrDash(
    value
) {

    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {

        return "—";

    }


    if (
        typeof value ===
        "number"
    ) {

        return Number.isInteger(
            value
        )
            ? String(value)
            : value.toFixed(2);

    }


    return String(
        value
    );

}


function formatNumber(
    value
) {

    if (
        !Number.isFinite(
            value
        )
    ) {

        return "—";

    }


    if (
        Math.abs(value) >= 10
    ) {

        return value.toFixed(0);

    }


    return value.toFixed(1);

}


/* =========================================================
   LOADING / ERROR
========================================================= */

function showMainLoading() {

    $("mainLoading")
        .classList.remove(
            "hidden"
        );

}


function hideMainLoading() {

    $("mainLoading")
        .classList.add(
            "hidden"
        );

}


function showError(
    message
) {

    $("errorMessage")
        .textContent =
        message;


    $("mainError")
        .classList.remove(
            "hidden"
        );

}


function hideError() {

    $("mainError")
        .classList.add(
            "hidden"
        );

}


function setWikiStatus(
    text,
    type = ""
) {

    const status =
        $("wikiStatus");


    status.textContent =
        text;


    status.classList.remove(
        "ok",
        "error"
    );


    if (type) {

        status.classList.add(
            type
        );

    }

}


/* =========================================================
   RETRY
========================================================= */

$("retryButton")
    .addEventListener(
        "click",
        async () => {

            hideError();

            showMainLoading();


            setWikiStatus(
                "Wikiへ再接続中…"
            );


            try {

                clearAnalyzerCache();


                weapons = [];

                imageMap.clear();

                selectedWeapon =
                    null;


                await loadWeaponIndex(
                    true
                );


                renderWeaponList();


                const defaultWeapon =
                    weapons.find(
                        weapon =>
                            titleKey(
                                weapon.page
                            ) ===
                            "splattershot"
                    ) ||
                    weapons[0];


                if (
                    defaultWeapon
                ) {

                    await Promise.allSettled([

                        selectWeapon(
                            defaultWeapon
                        ),

                        loadWeaponImages()

                    ]);

                }


            } catch (error) {

                hideMainLoading();


                showError(
                    error.message ||
                    "再接続に失敗しました。"
                );


                setWikiStatus(
                    "Wiki接続エラー",
                    "error"
                );

            }

        }
    );


/* =========================================================
   REFRESH
========================================================= */

$("refreshButton")
    .addEventListener(
        "click",
        async () => {

            clearAnalyzerCache();


            weapons = [];

            imageMap.clear();

            selectedWeapon =
                null;


            $("weaponList")
                .innerHTML =
                `
                <div class="side-loading">
                    Wikiから武器一覧を再取得中…
                </div>
                `;


            $("weaponContent")
                .classList.add(
                    "hidden"
                );


            hideError();

            showMainLoading();


            setWikiStatus(
                "Wikiを更新中…"
            );


            try {

                await loadWeaponIndex(
                    true
                );


                renderWeaponList();


                const defaultWeapon =
                    weapons.find(
                        weapon =>
                            titleKey(
                                weapon.page
                            ) ===
                            "splattershot"
                    ) ||
                    weapons[0];


                if (
                    defaultWeapon
                ) {

                    await selectWeapon(
                        defaultWeapon
                    );

                }


                await loadWeaponImages();


                setWikiStatus(
                    `Wiki更新完了（${weapons.length}件）`,
                    "ok"
                );


            } catch (error) {

                hideMainLoading();


                showError(
                    error.message ||
                    "Wiki更新に失敗しました。"
                );


                setWikiStatus(
                    "Wiki接続エラー",
                    "error"
                );

            }

        }
    );


/* =========================================================
   INITIALIZE
========================================================= */

async function initialize() {

    renderCategories();


    setWikiStatus(
        "Wiki接続中…"
    );


    try {

        /* -----------------------------------------------
           武器一覧だけ取得
        ----------------------------------------------- */

        await loadWeaponIndex();


        /* -----------------------------------------------
           先に一覧を表示
        ----------------------------------------------- */

        renderWeaponList();


        setWikiStatus(
            `武器一覧取得済み（${weapons.length}件）`,
            "ok"
        );


        /* -----------------------------------------------
           デフォルト武器
        ----------------------------------------------- */

        const defaultWeapon =
            weapons.find(
                weapon =>
                    titleKey(
                        weapon.page
                    ) ===
                    "splattershot"
            ) ||
            weapons[0];


        if (defaultWeapon) {

            /*
             * 詳細取得と画像取得を並行
             */

            await Promise.allSettled([

                selectWeapon(
                    defaultWeapon
                ),

                loadWeaponImages()

            ]);

        }


    } catch (error) {

        console.error(
            error
        );


        hideMainLoading();


        showError(
            error.message ||
            "Wikiへの接続に失敗しました。"
        );


        setWikiStatus(
            "Wiki接続エラー",
            "error"
        );

    }

}


/* =========================================================
   START
========================================================= */

initialize();
