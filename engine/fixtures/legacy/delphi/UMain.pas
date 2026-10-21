unit UMain;
interface
uses SysUtils, Classes, Forms;
type
  TfrmMain = class(TForm)
  end;
implementation
procedure Load;
begin
  Query.SQL.Text := 'select * from Orders where Id = 1';
end;
end.
