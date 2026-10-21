     H CTL-OPT DFTACTGRP(*NO)
       DCL-S custNo PACKED(7:0);
       EXEC SQL SELECT name INTO :name FROM CUSTMAST WHERE id = :custNo;
       CALLP PRINTIT(custNo);
