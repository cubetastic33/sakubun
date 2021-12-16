let known_kanji = new Set(localStorage.getItem("known_kanji"));

// TODO Check if it works with zero known kanji

if (!known_kanji.size) {
    $("#settings *:not(.container):not(.always):not(.always *)").hide();
    $("#range").html(
        "You don't have a kanji list, so you can't use this feature yet. Go to "
        + "<a href=\"/known_kanji\">known kanji</a> and create a list first."
    );
} else {
    // Set the default values for min and max based on the number of kanji added
    $("#min")[0].setAttribute("value", Math.min(1, known_kanji.size));
    $("#max")[0].setAttribute("value", Math.min(15, known_kanji.size));
}

// Restore settings from localStorage
let settings_min = localStorage.getItem("min_essay");
let settings_max = localStorage.getItem("max_essay");

const $min = $("#min");
const $max = $("#max");

if (settings_min) $min.val(settings_min);
if (settings_max) $max.val(settings_max);
$max.prop("min", $min.val());
$min.prop("max", $max.val());

const $settings = $("#settings");
const $generate = $("#generate");
const $report_dialog_button = $("#report_dialog button");

$settings.submit(e => {
    e.preventDefault();
    $generate.prop("disabled", true);

    let known_kanji = new Set(localStorage.getItem("known_kanji"));

    $.post("/essay", {
        "min": $("#min").val() || 1,
        "max": $("#max").val() || 1,
        "known_kanji": [...known_kanji].join(""),
    }, result => {
        // Analytics
        // pa is undefined when ad blockers block the microanalytics script
        if (typeof pa !== "undefined") pa.track({name: "essay"});
        $generate.prop("disabled", false);
        if (!result.length) {
            // If there were no results
            $("#no_results + .overlay").show();
            $("#no_results").show("slow");
        } else {
            $settings.hide();
            // Show the generated essay
            for (let i = 0; i < result.length; i++) {
                let reading = result[i][3].split(",")[0];
                $("#essay").append(`<span data-id="${result[i][0]}" data-meaning="${result[i][2]}" data-reading="${reading}">${result[i][1]}</span>`);
            }
            $("#essay span").on("click", function() {
                $("#floating section").html(`
                    <b>Sentence:</b> <span id="question">${this.innerText}</span><br>
                    <b>Reading:</b> <span id="kana">${this.dataset.reading}</span><br>
                    <b>Meaning:</b> <span id="meaning">${this.dataset.meaning}</span>
                `).parent().attr("data-id", this.dataset.id).show("slow");
            });
            $("#info").show();
        }
    }).fail(jqXHR => {
        if (jqXHR.status === 0) {
            $("#quiz_container").hide();
            $settings.html(
                "You're currently offline. Try reloading once you're connected to the internet."
            ).show();
        } else {
            alert("Error code " + jqXHR.status);
            $generate.prop("disabled", false);
        }
    });
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
    }
}

$("#report_type button").on("click", function () {
    $("#report_type").removeAttr("open");
    $("#report_type summary").text($(this).text()).attr("data-value", $(this).attr("data-value"));
    show_reference($(this).attr("data-value"));
});

$("#report").on("click", () => {
    $("#report_dialog + .overlay").show();
    $("#report_dialog").show("slow");
    show_reference($("#report_dialog summary").attr("data-value"));
});

$("#report_dialog form").submit(e => {
    e.preventDefault();
    $report_dialog_button.prop("disabled", true);
    let id = $("#floating").attr("data-id");
    $.post("/report", {
        sentence_id: id,
        report_type: $("#report_type summary").attr("data-value"),
        suggested: $("#suggested").val().trim().length ? $("#suggested").val().trim() : undefined,
        comment: $("#comment").val().trim().length ? $("#comment").val().trim() : undefined,
    }).done(result => {
        $report_dialog_button.prop("disabled", false);
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
    $(`#${this.id} .close, #${this.id} + .overlay`).on("click", () => {
        $(this).hide("slow", () => $(`#${this.id} + .overlay`).hide());
    });
});

// Pressing the enter key should go to the answer/next question if a quiz is going on
// Otherwise it should start the quiz
$(window).on("keypress", e => {
    if (e.key === "Enter") {
        if ($settings.is(":visible")) {
            $generate.click();
        }
    }
});
