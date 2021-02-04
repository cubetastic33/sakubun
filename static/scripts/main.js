// Clear input
$("#answer").val("");

// Basic IME
wanakana.bind($("#answer")[0]);

// Initialize kuroshiro
var kuroshiro = new Kuroshiro();
kuroshiro.init(new KuromojiAnalyzer({ dictPath: "/dict" }))

// Get questions from the server
// TODO store known kanji in localstorage
$.post("/sentences", result => {
    $("main").attr("data-sentences", result);
    $("main").attr("data-index", 0);
    $("#question").text(result.split(";")[0]);
});

$("form").submit(e => {
    e.preventDefault();
    let sentences = $("main").attr("data-sentences").split("|");
    let index = $("main").attr("data-index");
    if ($("#next").text() === "Show Answer") {
        // Show the answer
        let jap_sentence = sentences[index].split(";")[0];
        let eng_sentence = sentences[index].split(";")[1];
        $("#meaning").text(eng_sentence);
        $("#next").text("Next");
        // Check if answer was right
        kuroshiro.convert(jap_sentence, { mode: "normal", to: "hiragana" }).then(result => {
            $("#kana").text(result);
            let punctuation = /[\uFF5F-\uFF65\u3000-\u303F]/ug;
            if ($("#answer").val().replace(punctuation, "") === result.replace(punctuation, "")) {
                $("#answer").attr("class", "correct");
            } else {
                $("#answer").attr("class", "incorrect");
            }
        });
    } else {
        // Go to the next question
        // TODO fetch new questions once we run out
        index++;
        $("main").attr("data-index", index);
        $("#question").text(sentences[index].split(";")[0]);
        $("#meaning, #kana").empty();
        $("#answer").val("");
        $("#answer").attr("class", "");
        $("#next").text("Show Answer");
    }
});

$("#answer").on("input", function () {
    this.parentNode.dataset.value = this.value;
});
