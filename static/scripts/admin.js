$("#signout").click(() => {
    $.post("/admin_signout").done(() => location.href = "/");
});

// Event handlers to close dialogs
$("dialog").each(function () {
    $(`#${this.id} .close, #${this.id} + .overlay`).click(() => {
        $(this).hide("slow", () => $(`#${this.id} + .overlay`).hide());
    });
});

$(".reject, .accept").click(function () {
    let dialog = $(this).hasClass("reject") ? "confirmation" : "override";
    $(`#${dialog} + .overlay`).show();
    $(`#${dialog}`).attr("data-id", $(this).parent().parent().attr("data-id")).show("slow");
});

$("#confirmation button:last-child").click(() => {
    $("#confirmation button").prop("disabled", true);
    $.post("/delete_report", { value: $("#confirmation").attr("data-id") }).done(result => {
        console.log(result);
        if (result === "success") {
            location.reload();
        } else {
            $("#confirmation button").prop("disabled", false);
            alert("An error occurred");
        }
    });
});
