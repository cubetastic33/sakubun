function should_evaluate() {
    // Returns whether evaluation is required or not
    return known_kanji.size && $("#max").val() != 0 && $("#evaluate").is(":checked");
}

// Initialize kuroshiro
var kuroshiro = new Kuroshiro();

let known_kanji = new Set(localStorage.getItem("known_kanji"));

if (!known_kanji.size) {
    $("#settings *:not(#start_quiz):not(#range)").hide();
    $("#range").html(
        "Note: You haven't chosen any known kanji yet, so the quiz questions will consist only of "
        + "kana<br><br>"
    );
    localStorage.removeItem("evaluate");
} else {
    // Set the default values for min and max based on the number of kanji added
    $("#min")[0].setAttribute("value", Math.min(3, known_kanji.size));
    $("#max")[0].setAttribute("value", Math.min(15, known_kanji.size));
}

// Restore settings from localStorage
let settings_min = localStorage.getItem("min");
let settings_max = localStorage.getItem("max");
let settings_evaluate = localStorage.getItem("evaluate");

if (settings_min) $("#min").val(settings_min);
if (settings_max) $("#max").val(settings_max);
if (settings_evaluate) $("#evaluate").prop("checked", settings_evaluate == "true");
$("#max").prop("min", $("#min").val());
$("#min").prop("max", $("#max").val());

if ($("#max").val() == 0) {
    $("#evaluate").prop("checked", false);
    $("#settings .container, #settings .container ~ br").hide();
}

function warning(e) {
    // Save the setting only if this is run as a callback
    if (e) localStorage.setItem("evaluate", $("#evaluate").is(":checked"));
    if (should_evaluate()) {
        $(".warning").show();
    } else {
        $(".warning").hide();
    }
}

warning();
$("#settings").show();
$("#evaluate").change(warning);
$("#min").change(function () {
    localStorage.setItem("min", $(this).val());
    $("#max").prop("min", $(this).val());
});
$("#max").change(function () {
    localStorage.setItem("max", $(this).val());
    $("#min").prop("max", $(this).val());

    if ($("#max").val() == 0) {
        $("#settings .container, #settings .container ~ br").hide();
        if ($("#evaluate").is(":checked")) {
            $(".warning").hide();
        }
    } else {
        $("#settings .container, #settings .container ~ br").show();
        settings_evaluate = localStorage.getItem("evaluate");
        if (settings_evaluate) $("#evaluate").prop("checked", settings_evaluate == "true");
        if ($("#evaluate").is(":checked")) {
            $(".warning").show();
        }
    }
});

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
            $("#overlay").show();
            $("#no_results").show("slow");
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
            if (should_evaluate()) {
                kuroshiro.init(new KuromojiAnalyzer({ dictPath: "/dict" }));
            } else {
                $("#kana").hide();
            }
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
        if (should_evaluate()) {
            // Check if answer was right
            kuroshiro.convert(jap_sentence, { mode: "normal", to: "hiragana" }).then(result => {
                $("#kana").text(result);
                let punct = /[、。！？「」『』]/ug;
                if ($("#answer").val().replace(punct, "") === result.replace(punct, "")) {
                    $("#answer").attr("class", "correct");
                } else if ($("#answer").val().length) {
                    $("#answer").attr("class", "incorrect");
                }
            });
        }
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

$("#no_results button, #overlay").click(() => {
    $("#no_results").hide("slow", () => $("#overlay").hide());
});

$("#answer").on("input", function () {
    this.parentNode.dataset.value = this.value;
});
