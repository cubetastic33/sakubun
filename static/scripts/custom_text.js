// Initialize kuroshiro
var kuroshiro = new Kuroshiro();
kuroshiro.init(new KuromojiAnalyzer({ dictPath: "/dict" }));

function is_superset(set, subset) {
    for (let elem of subset) {
        if (!set.has(elem)) {
            return false;
        }
    }
    return true;
}

$("form").submit(e => {
    e.preventDefault();
    kuroshiro.convert($("textarea").val(), { mode: "furigana", to: "hiragana" }).then(result => {
        console.log(result);
        let known_kanji = new Set(localStorage.getItem("known_kanji"));
        $("#result").html(result.replaceAll("\n", "<br>"));

        $("ruby").each(function () {
            let word = new Set($(this).html().split("<rp>")[0]);
            console.log(word, known_kanji);
            if (is_superset(known_kanji, word)) {
                $(this).children().remove();
            }
        })
    });
});
