#!/usr/bin/perl
use strict;
use DBI;
print "Content-type: text/html\n\n";
my $sth = $dbh->prepare("SELECT id FROM visits");
