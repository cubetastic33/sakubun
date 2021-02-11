const ds = new DragSelect({
    area: document.querySelector("#kanji"),
    draggability: false,
    immediateDrag: false,
    dragKeys: { "up": [], "right": [], "down": [], "left": [] },
    selectedClass: "selected",
});

ds.subscribe("callback", ({ items, event }) => {
    if (items.length) {
        $("#remove").show();
    } else {
        $("#remove").hide();
    }
});

function kanji_grid() {
    // Reset the grid
    $("#kanji").empty();
    $("#remove").hide();

    // Show the number of kanji added
    let known_kanji = localStorage.getItem("known_kanji") || "";
    $("#num_known").text(known_kanji.length);

    // Fill the kanji grid
    for (let i = 0; i < known_kanji.length; i++) {
        $("#kanji").append(`<div class="selectable">${known_kanji[i]}</div>`);
    }

    ds.addSelectables(document.getElementsByClassName("selectable"));
}

$(document).ready(kanji_grid);

// Add kanji
$("#add_kanji").submit(e => {
    e.preventDefault();
    let known_kanji = new Set(localStorage.getItem("known_kanji"));
    // Regex to identify kanji
    let re = /[\u3400-\u4DB5\u4E00-\u9FCB\uF900-\uFA6A]/ug;
    for (let kanji of $("#new_kanji").val().matchAll(re)) {
        known_kanji.add(kanji[0]);
    }
    // Save updated kanji list to localStorage
    localStorage.setItem("known_kanji", [...known_kanji].join(""));
    // Reset the input field
    $("#new_kanji").val("");
    // Update kanji grid
    kanji_grid();
});

// Remove kanji
$("#remove").click(() => {
    $("#overlay").show();
    $("#confirmation").show("slow");
    $("#confirmation span").text($("#kanji div.selected").length);
});

$("#confirmation button:last-child").click(() => {
    // Remove the selected kanji
    let known_kanji = new Set(localStorage.getItem("known_kanji"));
    $("#kanji div.selected").each(function () {
        known_kanji.delete($(this).text());
    });
    // Save updated kanji list to localStorage
    localStorage.setItem("known_kanji", [...known_kanji].join(""));
    // Update kanji grid
    kanji_grid();
    // Hide the confirmation dialog
    $("#confirmation").hide("slow", () => $("#overlay").hide());
});

$("#confirmation button:first-child, #overlay").click(() => {
    $("#confirmation").hide("slow", () => $("#overlay").hide());
});

// Import kanji
$("#" + $("#import_from").val()).show();
$("#import_from").change(() => {
    $("#anki, #wanikani").hide();
    $("#" + $("#import_from").val()).show();
});

$("#file").siblings("div").text($("#file").val().split(/(\\|\/)/g).pop());
$("#file").change(function () {
    if ($("#file")[0].files[0].size > 2097152) {
        $("#file").parent().attr("class", "upload error");
        $("#anki button").prop("disabled", true);
    } else {
        $("#file").parent().attr("class", "upload");
        $("#anki button").prop("disabled", false);
    }
    $(this).siblings("div").text(this.value.split(/(\\|\/)/g).pop());
});

$("#anki").submit(function(e) {
    e.preventDefault();
    $("#anki button").prop("disabled", true);
    let form_data = new FormData();
    form_data.append("include_unlearnt", $("#include_unlearnt").is(":checked"));
    if ($("#file")[0].files[0].size > 4194304) {
        $("#file").parent().attr("class", "upload error");
        return;
    } else {
        $("#file").parent().attr("class", "upload");
    }
    form_data.append("file", $("#file")[0].files[0]);

    $.ajax({
        url: "/import_anki",
        type: "POST",
        data: form_data,
        processData: false,
        contentType: false,
    }).done(result => {
        console.log(result);
        // TODO preview kanji
        $("#anki button").prop("disabled", false);
    }).fail(console.log);
});

// Export kanji

function download(filename, text) {
    // Download a file
    var element = document.createElement("a");
    element.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(text));
    element.setAttribute("download", filename);
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
}

$("#export").click(() => {
    let d = new Date();
    let filename = `sakubun_kanji_list_${d.getFullYear()}_${d.getMonth() + 1}_${d.getDate()}.txt`;
    download(filename, localStorage.getItem("known_kanji"))
});
