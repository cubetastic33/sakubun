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

const preview_ds = new DragSelect({
    area: document.querySelector("#preview_kanji"),
    draggability: false,
    immediateDrag: false,
    dragKeys: { "up": [], "right": [], "down": [], "left": [] },
    selectedClass: "selected",
});

preview_ds.subscribe("callback", ({ items, event }) => {
    if (items.length) {
        $("#remove_from_preview").show();
    } else {
        $("#remove_from_preview").hide();
    }
});

function kanji_grid() {
    // Remove any previously added selectables
    ds.removeSelectables(document.querySelectorAll("#kanji .selectable"));
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

    ds.addSelectables(document.querySelectorAll("#kanji .selectable"));
}

$(document).ready(kanji_grid);

function add_kanji(text) {
    let known_kanji = new Set(localStorage.getItem("known_kanji"));
    // Regex to identify kanji
    let re = /[\u3005\u3400-\u4DB5\u4E00-\u9FCB\uF900-\uFA6A]/gu;
    for (let kanji of text.matchAll(re)) {
        known_kanji.add(kanji[0]);
    }
    // Save updated kanji list to localStorage
    localStorage.setItem("known_kanji", [...known_kanji].join(""));
    // Update kanji grid
    kanji_grid();
    // Analytics
    pa.track({name: "kanji added"});
}

// Add kanji
$("#add_kanji").submit(e => {
    e.preventDefault();
    add_kanji($("#new_kanji").val());
    // Reset the input field
    $("#new_kanji").val("");
});

// Remove kanji
$("#remove").click(() => {
    $("#confirmation + .overlay").show();
    $("#confirmation").attr("data-grid", "kanji").show("slow");
    $("#confirmation span").text(`the ${$("#kanji div.selected").length} selected`);
});

$("#remove_all").click(() => {
    $("#confirmation + .overlay").show();
    $("#confirmation").attr("data-grid", "all").show("slow");
    let num_kanji = new Set(localStorage.getItem("known_kanji")).size;
    $("#confirmation span").text(`all ${num_kanji}`);
});

$("#confirmation button:last-child").click(() => {
    // Remove the selected kanji
    if ($("#confirmation").attr("data-grid") === "all") {
        localStorage.removeItem("known_kanji");
        kanji_grid();
    } else if ($("#confirmation").attr("data-grid") === "kanji") {
        let known_kanji = new Set(localStorage.getItem("known_kanji"));
        $("#kanji div.selected").each(function () {
            known_kanji.delete($(this).text());
        });
        // Save updated kanji list to localStorage
        localStorage.setItem("known_kanji", [...known_kanji].join(""));
        // Update kanji grid
        kanji_grid();
    } else {
        $("#remove_from_preview").hide();
        $("#preview_kanji div.selected").remove();
        $("#num_preview").text($("#preview_kanji div").length);
    }
    // Hide the confirmation dialog
    $("#confirmation").hide("slow", () => $("#confirmation + .overlay").hide());
});

// Event handlers to close dialogs
$("dialog").each(function () {
    $(`#${this.id} .close, #${this.id} + .overlay`).click(() => {
        $(this).hide("slow", () => $(`#${this.id} + .overlay`).hide());
        if (this.id === "preview") {
            // If the preview dialog was closed, reset the previewed kanji
            $("#preview_kanji").empty();
            $("#remove_from_preview").hide();
        }
    });
});

// More options

$("#more_options > button").click(() => {
    $("#more_options > div").toggle();
    let text = $("#more_options > button").text().split(" ")[0];
    $("#more_options > button").text((text === "More" ? "Less" : "More") + " options");
});

$(".select li").click(function () {
    $(this).parent().parent().removeAttr("open");
    $(this)
        .parent()
        .siblings("summary")
        .text($(this).text())
        .attr("data-value", $(this).attr("data-value"));
});

// Import kanji
$("#" + $("#import_from summary").attr("data-value")).show();
$("#import_from li").click(function () {
    $(".import_option").hide();
    $("#" + this.dataset.value).show();
});

$("#wanikani input").prop("max", $("#wanikani .select li").attr("data-value") === "stages" ? "60" : "2055");
$("#wanikani .select li").click(function () {
    $("#wanikani input").prop("max", this.dataset.value === "stages" ? "60" : "2055");
});

$("#rtk input").prop("max", $("#rtk .select li").attr("data-value") === "stages" ? "56" : "2200");
$("#rtk .select li").click(function () {
    $("#rtk input").prop("max", this.dataset.value === "stages" ? "56" : "2200");
});

$("#file").siblings("div").text($("#file").val().split(/([\\/])/g).pop());
$("#file").change(function () {
    if ($("#file")[0].files[0].size > 4194304) {
        $("#file").parent().attr("class", "upload error");
        $("#anki button").prop("disabled", true);
    } else {
        $("#file").parent().attr("class", "upload");
        $("#anki button").prop("disabled", false);
    }
    $(this).siblings("div").text(this.value.split(/([\\/])/g).pop());
});

function preview_kanji(kanji, method) {
    if (!kanji.length) {
        // No kanji were found
        $("#no_kanji_found + .overlay").show();
        $("#no_kanji_found").show("slow");
        return;
    }
    // Preview kanji

    // Show the preview dialog
    $("#preview + .overlay").show();
    $("#preview").show("slow");
    // Set the method as a data attribute - this is used for analytics once the kanji are added
    $("#preview").attr("data-method", method);
    // Remove any previously added selectables
    preview_ds.removeSelectables(document.querySelectorAll("#preview .selectable"));
    // Reset the grid
    $("#preview_kanji").empty();
    // Show the number of kanji added
    $("#num_preview").text(kanji.length);
    // Fill the kanji grid
    for (let i = 0; i < kanji.length; i++) {
        $("#preview_kanji").append(`<div class="selectable">${kanji[i]}</div>`);
    }
    preview_ds.addSelectables(document.querySelectorAll("#preview .selectable"));
}

$("#anki").submit(e => {
    e.preventDefault();
    $("#anki button").prop("disabled", true);
    let form_data = new FormData();
    form_data.append("only_learnt", $("#only_learnt").is(":checked"));
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
        // Enable the import button again
        $("#anki button").prop("disabled", false);
        preview_kanji(result, "anki");
    }).fail(console.log);
});

$("#wanikani form:first-child").submit(e => {
    e.preventDefault();
    $("#wanikani button").prop("disabled", true);
    $.post("/import_wanikani_api", { key: $("#api_key").val().trim() }).done(result => {
        // Enable the import buttons again
        $("#wanikani button").prop("disabled", false);
        preview_kanji(result, "wanikani");
    }).fail(error => {
        console.log(error);
        alert("An error occurred");
        $("#wanikani button").prop("disabled", false);
    });
});

$("#wanikani form:last-child").submit(e => {
    e.preventDefault();
    $("#wanikani button").prop("disabled", true);
    $.post("/import_wanikani", {
        number: $("#wanikani input:not(#api_key)").val(),
        method: $(`#wanikani summary`).attr("data-value"),
    }).done(result => {
        // Enable the import buttons again
        $("#wanikani button").prop("disabled", false);
        preview_kanji(result, "wanikani");
    }).fail(error => {
        console.log(error);
        alert("An error occurred");
        $("#wanikani button").prop("disabled", false);
    });
});

$(".import_option:not(#anki):not(#wanikani)").submit(function (e) {
    e.preventDefault();
    $(this).children("button").prop("disabled", true);
    let number;
    if (this.id === "rtk") {
        number = $(this).children("input").val();
    } else {
        number = $(`#${this.id} summary`).attr("data-value");
    }
    $.post(`/import_${this.id}`, {
        number: number,
        method: this.id === "rtk" ? $(`#${this.id} summary`).attr("data-value") : "stages",
    }).done(result => {
        // Enable the import button again
        $(this).children("button").prop("disabled", false);
        preview_kanji(result, this.id);
    }).fail(console.log);
});

$("#remove_from_preview").click(() => {
    $("#confirmation + .overlay").show();
    $("#confirmation").attr("data-grid", "preview_kanji").show("slow");
    $("#confirmation span").text(`the ${$("#preview_kanji div.selected").length} selected`);
});

$("#preview button:last-child").click(() => {
    // Add the kanji
    add_kanji($("#preview_kanji").text());
    // Analytics
    pa.track({name: `[${$("#preview").attr("data-method")}] kanji added`});
    $("#preview_kanji").empty();
    $("#remove_from_preview").hide();
    $("#preview").hide("slow", () => $("#preview + .overlay").hide());
});

// Export kanji

function download(filename, text) {
    // Download a file
    let element = document.createElement("a");
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
