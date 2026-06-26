Sub GetchDetails()

Dim IE As Object ' InternetExplorer.Application
Dim url As String
Dim delivery As String

Dim sh As Worksheet
Dim rw As Range
'ThisWorkbook.Sheets("Sheet1").Range("B3:Z100000").ClearContents
ThisWorkbook.Sheets("Sheet1").Activate
Application.ScreenUpdating = True

Set sh = ActiveSheet

For Each rw In sh.Rows
    
 If rw.Row > 2 And sh.Cells(rw.Row, 3).Value = "" Then
    If sh.Cells(rw.Row, 1).Value = "" Then
        Exit For
    End If

    Set IE = CreateObject("InternetExplorer.Application")
    
    If Len(Trim(sh.Cells(rw.Row, 1).Value)) = 10 And InStr(Trim(sh.Cells(rw.Row, 1).Value), " ") = 0 And (Left(Trim(sh.Cells(rw.Row, 1).Value), 1) = "B" Or Left(Trim(sh.Cells(rw.Row, 1).Value), 1) = "b") Then
        url = "https://" + Trim(sh.Cells(1, 2).Value) + "/dp/" + UCase(Trim(sh.Cells(rw.Row, 1).Value))
    Else
        url = "https://" + Trim(sh.Cells(1, 2).Value) + "/s?k=" + Replace(Trim(sh.Cells(rw.Row, 1).Value), " ", "+")
    End If
    On Error Resume Next
   
    IE.Navigate2 url
    Do While IE.Busy = True
       DoEvents
    Loop

    Set HTMLDoc = IE.document
    'Get info from HTML by ID and Name
    Range(Cells(rw.Row, 3).Address(), Cells(rw.Row, 50).Address()).Clear
    
    If Len(Trim(sh.Cells(rw.Row, 1).Value)) = 10 Then
        Cells(rw.Row, 3).Value = UCase(Trim(sh.Cells(rw.Row, 1).Value))
        Cells(rw.Row, 4).Value = HTMLDoc.getElementById("productTitle").innerText
        Cells(rw.Row, 5).Value = HTMLDoc.getElementsByClassName("a-price-whole")(0).innerText
        Cells(rw.Row, 6).Value = HTMLDoc.getElementsByClassName("a-icon a-icon-star a-star-3-5 cm-cr-review-stars-spacing-big")(0).innerText + Chr(10) + CStr(Val(Replace(Replace(Replace(HTMLDoc.getElementById("acrCustomerReviewText").innerText, "ratings", ""), "rating", ""), ",", ""))) _
                                 + Chr(10) + Chr(10) + HTMLDoc.getElementById("deliveryBlockMessage").innerText
    Else
            Set Product1 = HTMLDoc.getElementsByClassName("s-widget-container s-spacing-small s-widget-container-height-small celwidget slot=MAIN template=SEARCH_RESULTS widgetId=search-results_1")(0)
            Set Product2 = HTMLDoc.getElementsByClassName("s-widget-container s-spacing-small s-widget-container-height-small celwidget slot=MAIN template=SEARCH_RESULTS widgetId=search-results_2")(0)
            Set Product3 = HTMLDoc.getElementsByClassName("s-widget-container s-spacing-small s-widget-container-height-small celwidget slot=MAIN template=SEARCH_RESULTS widgetId=search-results_3")(0)
            Set Product4 = HTMLDoc.getElementsByClassName("s-widget-container s-spacing-small s-widget-container-height-small celwidget slot=MAIN template=SEARCH_RESULTS widgetId=search-results_4")(0)
            Set Product5 = HTMLDoc.getElementsByClassName("s-widget-container s-spacing-small s-widget-container-height-small celwidget slot=MAIN template=SEARCH_RESULTS widgetId=search-results_5")(0)
            Set Product6 = HTMLDoc.getElementsByClassName("s-widget-container s-spacing-small s-widget-container-height-small celwidget slot=MAIN template=SEARCH_RESULTS widgetId=search-results_6")(0)
            Set Product7 = HTMLDoc.getElementsByClassName("s-widget-container s-spacing-small s-widget-container-height-small celwidget slot=MAIN template=SEARCH_RESULTS widgetId=search-results_7")(0)
            Set Product8 = HTMLDoc.getElementsByClassName("s-widget-container s-spacing-small s-widget-container-height-small celwidget slot=MAIN template=SEARCH_RESULTS widgetId=search-results_8")(0)
            Set Product9 = HTMLDoc.getElementsByClassName("s-widget-container s-spacing-small s-widget-container-height-small celwidget slot=MAIN template=SEARCH_RESULTS widgetId=search-results_9")(0)
            Set Product10 = HTMLDoc.getElementsByClassName("s-widget-container s-spacing-small s-widget-container-height-small celwidget slot=MAIN template=SEARCH_RESULTS widgetId=search-results_10")(0)
            
            If Not Product1.getElementsByClassName("a-popover-preload")(0) Is Nothing Then
                Cells(rw.Row, 3).Value = "*" & Replace(Product1.getElementsByClassName("a-popover-preload")(0).ID, "a-popover-sp-info-popover-", "")
                Cells(rw.Row, 3).Interior.Color = RGB(255, 255, 0)
            Else
                Cells(rw.Row, 3).Value = Mid(Product1.innerHTML, InStr(Product1.innerHTML, "/dp/") + 4, 10)
                Cells(rw.Row, 3).Interior.Color = RGB(255, 255, 255)
            End If
            Cells(rw.Row, 4).Value = Product1.getElementsByClassName("a-size-base-plus a-color-base a-text-normal")(0).innerText
            Cells(rw.Row, 5).Value = Product1.getElementsByClassName("a-price-whole")(0).innerText
            delivery = Replace(Product1.getElementsByClassName("a-row a-size-base a-color-secondary s-align-children-center")(0).innerText, "Get it by", "")
            Cells(rw.Row, 6).Value = Product1.getElementsByClassName("a-row a-size-small")(0).innerText + Chr(10) + Chr(10) + Left(delivery, InStr(delivery, "FREE") - 2)
            
            If Not Product2.getElementsByClassName("a-popover-preload")(0) Is Nothing Then
                Cells(rw.Row, 7).Value = "*" & Replace(Product2.getElementsByClassName("a-popover-preload")(0).ID, "a-popover-sp-info-popover-", "")
                Cells(rw.Row, 7).Interior.Color = RGB(255, 255, 0)
            Else
                Cells(rw.Row, 7).Value = Mid(Product2.innerHTML, InStr(Product2.innerHTML, "/dp/") + 4, 10)
                Cells(rw.Row, 7).Interior.Color = RGB(255, 255, 255)
            End If
            Cells(rw.Row, 8).Value = Product2.getElementsByClassName("a-size-base-plus a-color-base a-text-normal")(0).innerText
            Cells(rw.Row, 9).Value = Product2.getElementsByClassName("a-price-whole")(0).innerText
            delivery = Replace(Product2.getElementsByClassName("a-row a-size-base a-color-secondary s-align-children-center")(0).innerText, "Get it by", "")
            Cells(rw.Row, 10).Value = Product2.getElementsByClassName("a-row a-size-small")(0).innerText + Chr(10) + Chr(10) + Left(delivery, InStr(delivery, "FREE") - 2)
            
            If Not Product3.getElementsByClassName("a-popover-preload")(0) Is Nothing Then
                Cells(rw.Row, 11).Value = "*" & Replace(Product3.getElementsByClassName("a-popover-preload")(0).ID, "a-popover-sp-info-popover-", "")
                Cells(rw.Row, 11).Interior.Color = RGB(255, 255, 0)
            Else
                Cells(rw.Row, 11).Value = Mid(Product3.innerHTML, InStr(Product3.innerHTML, "/dp/") + 4, 10)
                Cells(rw.Row, 11).Interior.Color = RGB(255, 255, 255)
            End If
            Cells(rw.Row, 12).Value = Product3.getElementsByClassName("a-size-base-plus a-color-base a-text-normal")(0).innerText
            Cells(rw.Row, 13).Value = Product3.getElementsByClassName("a-price-whole")(0).innerText
            delivery = Replace(Product3.getElementsByClassName("a-row a-size-base a-color-secondary s-align-children-center")(0).innerText, "Get it by", "")
            Cells(rw.Row, 14).Value = Product3.getElementsByClassName("a-row a-size-small")(0).innerText + Chr(10) + Chr(10) + Left(delivery, InStr(delivery, "FREE") - 2)
            
            If Not Product4.getElementsByClassName("a-popover-preload")(0) Is Nothing Then
                Cells(rw.Row, 15).Value = "*" & Replace(Product4.getElementsByClassName("a-popover-preload")(0).ID, "a-popover-sp-info-popover-", "")
                Cells(rw.Row, 15).Interior.Color = RGB(255, 255, 0)
            Else
                Cells(rw.Row, 15).Value = Mid(Product4.innerHTML, InStr(Product4.innerHTML, "/dp/") + 4, 10)
                Cells(rw.Row, 15).Interior.Color = RGB(255, 255, 255)
            End If
            Cells(rw.Row, 16).Value = Product4.getElementsByClassName("a-size-base-plus a-color-base a-text-normal")(0).innerText
            Cells(rw.Row, 17).Value = Product4.getElementsByClassName("a-price-whole")(0).innerText
            delivery = Replace(Product4.getElementsByClassName("a-row a-size-base a-color-secondary s-align-children-center")(0).innerText, "Get it by", "")
            Cells(rw.Row, 18).Value = Product4.getElementsByClassName("a-row a-size-small")(0).innerText + Chr(10) + Chr(10) + Left(delivery, InStr(delivery, "FREE") - 2)
            
            If Not Product5.getElementsByClassName("a-popover-preload")(0) Is Nothing Then
                Cells(rw.Row, 19).Value = "*" & Replace(Product5.getElementsByClassName("a-popover-preload")(0).ID, "a-popover-sp-info-popover-", "")
                Cells(rw.Row, 19).Interior.Color = RGB(255, 255, 0)
            Else
                Cells(rw.Row, 19).Value = Mid(Product5.innerHTML, InStr(Product5.innerHTML, "/dp/") + 4, 10)
                Cells(rw.Row, 19).Interior.Color = RGB(255, 255, 255)
            End If
            Cells(rw.Row, 20).Value = Product5.getElementsByClassName("a-size-base-plus a-color-base a-text-normal")(0).innerText
            Cells(rw.Row, 21).Value = Product5.getElementsByClassName("a-price-whole")(0).innerText
            delivery = Replace(Product5.getElementsByClassName("a-row a-size-base a-color-secondary s-align-children-center")(0).innerText, "Get it by", "")
            Cells(rw.Row, 22).Value = Product5.getElementsByClassName("a-row a-size-small")(0).innerText + Chr(10) + Chr(10) + Left(delivery, InStr(delivery, "FREE") - 2)
            
            If Not Product6.getElementsByClassName("a-popover-preload")(0) Is Nothing Then
                Cells(rw.Row, 23).Value = "*" & Replace(Product6.getElementsByClassName("a-popover-preload")(0).ID, "a-popover-sp-info-popover-", "")
                Cells(rw.Row, 23).Interior.Color = RGB(255, 255, 0)
            Else
                Cells(rw.Row, 23).Value = Mid(Product6.innerHTML, InStr(Product6.innerHTML, "/dp/") + 4, 10)
                Cells(rw.Row, 23).Interior.Color = RGB(255, 255, 255)
            End If
            Cells(rw.Row, 24).Value = Product6.getElementsByClassName("a-size-base-plus a-color-base a-text-normal")(0).innerText
            Cells(rw.Row, 25).Value = Product6.getElementsByClassName("a-price-whole")(0).innerText
            delivery = Replace(Product6.getElementsByClassName("a-row a-size-base a-color-secondary s-align-children-center")(0).innerText, "Get it by", "")
            Cells(rw.Row, 26).Value = Product6.getElementsByClassName("a-row a-size-small")(0).innerText + Chr(10) + Chr(10) + Left(delivery, InStr(delivery, "FREE") - 2)
            
            If Not Product7.getElementsByClassName("a-popover-preload")(0) Is Nothing Then
                Cells(rw.Row, 27).Value = "*" & Replace(Product7.getElementsByClassName("a-popover-preload")(0).ID, "a-popover-sp-info-popover-", "")
                Cells(rw.Row, 27).Interior.Color = RGB(255, 255, 0)
            Else
                Cells(rw.Row, 27).Value = Mid(Product7.innerHTML, InStr(Product7.innerHTML, "/dp/") + 4, 10)
                Cells(rw.Row, 27).Interior.Color = RGB(255, 255, 255)
            End If
            Cells(rw.Row, 28).Value = Product7.getElementsByClassName("a-size-base-plus a-color-base a-text-normal")(0).innerText
            Cells(rw.Row, 29).Value = Product7.getElementsByClassName("a-price-whole")(0).innerText
            delivery = Replace(Product7.getElementsByClassName("a-row a-size-base a-color-secondary s-align-children-center")(0).innerText, "Get it by", "")
            Cells(rw.Row, 30).Value = Product7.getElementsByClassName("a-row a-size-small")(0).innerText + Chr(10) + Chr(10) + Left(delivery, InStr(delivery, "FREE") - 2)
            
            If Not Product8.getElementsByClassName("a-popover-preload")(0) Is Nothing Then
                Cells(rw.Row, 31).Value = "*" & Replace(Product8.getElementsByClassName("a-popover-preload")(0).ID, "a-popover-sp-info-popover-", "")
                Cells(rw.Row, 31).Interior.Color = RGB(255, 255, 0)
            Else
                Cells(rw.Row, 31).Value = Mid(Product8.innerHTML, InStr(Product8.innerHTML, "/dp/") + 4, 10)
                Cells(rw.Row, 31).Interior.Color = RGB(255, 255, 255)
            End If
            Cells(rw.Row, 32).Value = Product8.getElementsByClassName("a-size-base-plus a-color-base a-text-normal")(0).innerText
            Cells(rw.Row, 33).Value = Product8.getElementsByClassName("a-price-whole")(0).innerText
            delivery = Replace(Product8.getElementsByClassName("a-row a-size-base a-color-secondary s-align-children-center")(0).innerText, "Get it by", "")
            Cells(rw.Row, 34).Value = Product8.getElementsByClassName("a-row a-size-small")(0).innerText + Chr(10) + Chr(10) + Left(delivery, InStr(delivery, "FREE") - 2)
            
            If Not Product9.getElementsByClassName("a-popover-preload")(0) Is Nothing Then
                Cells(rw.Row, 35).Value = "*" & Replace(Product9.getElementsByClassName("a-popover-preload")(0).ID, "a-popover-sp-info-popover-", "")
                Cells(rw.Row, 35).Interior.Color = RGB(255, 255, 0)
            Else
                Cells(rw.Row, 35).Value = Mid(Product9.innerHTML, InStr(Product9.innerHTML, "/dp/") + 4, 10)
                Cells(rw.Row, 35).Interior.Color = RGB(255, 255, 255)
            End If
            Cells(rw.Row, 36).Value = Product9.getElementsByClassName("a-size-base-plus a-color-base a-text-normal")(0).innerText
            Cells(rw.Row, 37).Value = Product9.getElementsByClassName("a-price-whole")(0).innerText
            delivery = Replace(Product9.getElementsByClassName("a-row a-size-base a-color-secondary s-align-children-center")(0).innerText, "Get it by", "")
            Cells(rw.Row, 38).Value = Product9.getElementsByClassName("a-row a-size-small")(0).innerText + Chr(10) + Chr(10) + Left(delivery, InStr(delivery, "FREE") - 2)
            
            If Not Product10.getElementsByClassName("a-popover-preload")(0) Is Nothing Then
                Cells(rw.Row, 39).Value = "*" & Replace(Product10.getElementsByClassName("a-popover-preload")(0).ID, "a-popover-sp-info-popover-", "")
                Cells(rw.Row, 39).Interior.Color = RGB(255, 255, 0)
            Else
                Cells(rw.Row, 39).Value = Mid(Product10.innerHTML, InStr(Product10.innerHTML, "/dp/") + 4, 10)
                Cells(rw.Row, 39).Interior.Color = RGB(255, 255, 255)
            End If
            Cells(rw.Row, 40).Value = Product10.getElementsByClassName("a-size-base-plus a-color-base a-text-normal")(0).innerText
            Cells(rw.Row, 41).Value = Product10.getElementsByClassName("a-price-whole")(0).innerText
            delivery = Replace(Product10.getElementsByClassName("a-row a-size-base a-color-secondary s-align-children-center")(0).innerText, "Get it by", "")
            Cells(rw.Row, 42).Value = Product10.getElementsByClassName("a-row a-size-small")(0).innerText + Chr(10) + Chr(10) + Left(delivery, InStr(delivery, "FREE") - 2)
    End If
    IE.Quit
    
 End If
Next rw

Application.ScreenUpdating = True
MsgBox "Done"

End Sub



