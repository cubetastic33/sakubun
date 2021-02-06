// Initialize kuroshiro
var kuroshiro = new Kuroshiro();

let known_kanji = new Set(localStorage.getItem("known_kanji"));

if (!known_kanji.size) {
    $("#settings div")
        .html("Note: You haven't chosen any known kanji yet, so the quiz questions will consist only of kana");
} else {
    // Set the default values for min and max based on the number of kanji added
    $("#min")[0].setAttribute("value", Math.min(3, known_kanji.size));
    $("#max")[0].setAttribute("value", Math.min(15, known_kanji.size));
}
$("#settings").show();

$("#settings").submit(e => {
    e.preventDefault();
    $("#start_quiz").prop("disabled", true);
    // Get questions from the server
    $.post("/sentences", {
        "min": $("#min").val() || 0,
        "max": $("#max").val() || 0,
        "known_kanji": [...known_kanji].join(""),
    }, result => {
        if (!result.length) {
            $("#start_quiz").prop("disabled", false);
            alert("No results found! Please try adjusting the min and max kanji parameters and try again.");
        } else {
            $("#quiz").attr("data-sentences", result);
            $("#quiz").attr("data-index", 0);
            $("#question").text(result.split(";")[0]);
            $("#settings").hide();
            $("#quiz_container").show();
            // Clear input
            $("#answer").val("");
            // Basic IME
            wanakana.bind($("#answer")[0]);
            kuroshiro.init(new KuromojiAnalyzer({ dictPath: "/dict" }))
        }
    });
});

$("#quiz_container").submit(e => {
    e.preventDefault();
    let sentences = $("#quiz").attr("data-sentences").split("|");
    let index = $("#quiz").attr("data-index");
    if ($("#next").text() === "Show Answer") {
        // Show the answer
        let jap_sentence = sentences[index].split(";")[0];
        let eng_sentence = sentences[index].split(";")[1];
        $("#meaning").text(eng_sentence);
        $("#next").text("Next");
        // Check if answer was right
        kuroshiro.convert(jap_sentence, { mode: "normal", to: "hiragana" }).then(result => {
            $("#kana").text(result);
            let punctuation = /[、。！？「」『』]/ug;
            if ($("#answer").val().replace(punctuation, "") === result.replace(punctuation, "")) {
                $("#answer").attr("class", "correct");
            } else if ($("#answer").val().length) {
                $("#answer").attr("class", "incorrect");
            }
        });
    } else {
        // Go to the next question
        // TODO fetch new questions once we run out
        index++;
        $("#quiz").attr("data-index", index);
        $("#question").text(sentences[index].split(";")[0]);
        $("#meaning, #kana").empty();
        $("#answer").val("");
        $("#answer")[0].parentNode.dataset.value = "";
        $("#answer").attr("class", "");
        $("#next").text("Show Answer");
    }
});

$("#answer").on("input", function () {
    this.parentNode.dataset.value = this.value;
});
