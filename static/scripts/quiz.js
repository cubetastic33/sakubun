function should_evaluate() {
    // Returns whether evaluation is required or not
    return known_kanji.size && $("#max").val() != 0 && $("#evaluate").is(":checked");
}

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

// Should only be true the first time get_questions() is run
var init = true;

function show_quiz() {
    $("#settings").hide();
    $("#quiz_container").show();
    // Clear input
    $("#meaning, #kana").empty();
    $("#answer").val("").attr("class", "");
    resize_answer_box();
    $("#next").text("Show Answer").prop("disabled", false);
    $("#report").hide();
}

function get_questions() {
    let known_kanji = new Set(localStorage.getItem("known_kanji"));

    $.post("/sentences", {
        "min": $("#min").val() || 0,
        "max": $("#max").val() || 0,
        "known_kanji": [...known_kanji].join(""),
    }, result => {
        // Analytics
        pa.track({name: "quiz"});
        if (!result.length) {
            // If there were no results
            $("#start_quiz").prop("disabled", false);
            $("#quiz_container").hide();
            $("#settings").show();
            $("#no_results + .overlay").show();
            $("#no_results").show("slow");
        } else {
            // Show the question
            $("#quiz").attr("data-sentences", result);
            $("#quiz").attr("data-index", 0);
            $("#question").text(result.split(";")[1]);
            if (init) {
                // Basic IME
                wanakana.bind($("#answer")[0]);
                if (should_evaluate()) {
                    $("#kana").show();
                    show_quiz();
                } else {
                    $("#kana").hide();
                    show_quiz();
                }
                init = false;
            } else {
                // Reset answer
                show_quiz();
            }
        }
    }).fail(jqXHR => {
        if (jqXHR.status === 0) {
            $("#quiz_container").hide();
            $("#settings").html(
                "You're currently offline. Try reloading once you're connected to the internet."
            ).show();
        } else {
            alert("Error code " + jqXHR.status);
        }
    });
}

$("#settings").submit(e => {
    e.preventDefault();
    $("#start_quiz, #next").prop("disabled", true);
    // Get questions from the server
    get_questions();
});

$("#quiz_container").submit(e => {
    e.preventDefault();
    $("#next").prop("disabled", true);
    let sentences = $("#quiz").attr("data-sentences").split("|");
    let index = $("#quiz").attr("data-index");
    if ($("#next").text() === "Show Answer") {
        // Show the answer
        let jpn_sentence = sentences[index].split(";")[1];
        let eng_sentence = sentences[index].split(";")[2];
        let readings = sentences[index].split(";")[3].split(",");
        $("#meaning").text(eng_sentence);
        $("#next").text("Next").prop("disabled", false);
        // Show the report button
        $("#report").show();
        if (should_evaluate()) {
            // Check if answer was right
            $("#kana").text(readings[0]);
            let punct = /[、。！？「」『』]/ug;
            let answer = wanakana.toHiragana($("#answer").val()).replace(punct, "");
            for (let i = 0; i < readings.length; i++) {
                if (answer === wanakana.toHiragana(readings[i]).replace(punct, "")) {
                    $("#answer").attr("class", "correct");
                }
            }
            // If the user provided an answer but it didn't match with any of the readings
            if ($("#answer").val().length && !$("#answer").hasClass("correct")) {
                $("#answer").attr("class", "incorrect");
            }
        }
    } else {
        // Go to the next question
        index++;
        if (index < sentences.length) {
            $("#quiz").attr("data-index", index);
            $("#question").text(sentences[index].split(";")[1]);
            $("#meaning, #kana").empty();
            $("#answer").val("").attr("class", "");
            resize_answer_box();
            $("#next").text("Show Answer").prop("disabled", false);
            $("#report").hide();
        } else {
            // We've run out of questions, so fetch new ones
            get_questions();
        }
    }
});

// Report option
function show_reference(report_type) {
    $("#report_dialog span").text(report_type);
    if (report_type === "translation") {
        $("#reference").text($("#meaning").text());
    } else if (report_type === "question") {
        $("#reference").text($("#question").text());
    } else if (report_type === "reading") {
        $("#reference").text($("#kana").text());
        $("#suggested").val($("#answer").val());
    }
}

$("#report_type li").click(function () {
    $("#report_type").removeAttr("open");
    $("#report_type summary").text($(this).text()).attr("data-value", $(this).attr("data-value"));
    show_reference($(this).attr("data-value"));
});

$("#report").click(() => {
    $("#report_dialog + .overlay").show();
    $("#report_dialog").attr("class", should_evaluate() ? "" : "no_evaluate").show("slow");
    show_reference($("#report_dialog summary").attr("data-value"));
});

$("#report_dialog form").submit(e => {
    e.preventDefault();
    $("#report_dialog button").prop("disabled", true);
    let id = $("#quiz").attr("data-sentences").split("|")[$("#quiz").attr("data-index")].split(";")[0];
    $.post("/report", {
        sentence_id: id,
        report_type: $("#report_type summary").attr("data-value"),
        suggested: $("#suggested").val() ? $("#suggested").val().length : undefined,
        comment: $("#comment").val().length ? $("#comment").val() : undefined,
    }).done(result => {
        $("#report_dialog button").prop("disabled", false);
        if (result === "success") {
            $("#report_dialog form").trigger("reset");
            $("#report_dialog").hide("slow").then($("#report_dialog + .overlay").hide());
        } else {
            alert(result);
        }
    });
});

// Event handlers to close dialogs
$("dialog").each(function () {
    $(`#${this.id} .close, #${this.id} + .overlay`).click(() => {
        $(this).hide("slow", () => $(`#${this.id} + .overlay`).hide());
    });
});

// Auto-resize height of answer box
function resize_answer_box() {
    let elem = $("#answer")[0];
    $(elem).css("height", "auto");
    $(elem).css("height", elem.scrollHeight + "px");
}

$("#answer").on("input", resize_answer_box);
$(window).resize(resize_answer_box);

// Pressing enter in the answer box should submit
$("#answer").keypress(e => {
    if (e.key === "Enter") {
        e.preventDefault();
        $("#quiz").submit();
    }
});
