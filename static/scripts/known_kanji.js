$("#kanji span").click(function () {
    if ($(this).hasClass("selected")) {
        $(this).removeClass("selected");
        if (!$("#kanji span.selected").length) {
            $("#remove").hide();
        }
    } else {
        $(this).attr("class", "selected");
        if (("#kanji span.selected").length) {
            $("#remove").show();
        }
    }
});
