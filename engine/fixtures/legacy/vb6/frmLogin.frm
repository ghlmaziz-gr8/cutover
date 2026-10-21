VERSION 5.00
Begin VB.Form frmLogin
   Caption = "Sign in"
   Begin VB.CommandButton cmdOK
   End
End
Attribute VB_Name = "frmLogin"
Private Declare Function GetTickCount Lib "kernel32" () As Long
Sub Load()
    rs.Open "SELECT * FROM Users WHERE ID = 1", conn
End Sub
