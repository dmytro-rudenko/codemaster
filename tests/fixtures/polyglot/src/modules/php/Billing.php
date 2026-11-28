<?php
const LIMIT = 10;

function create($first, $second, $third, $fourth, $fifth, $sixth)
{
    return $first;
}

function walk(array $items)
{
    if ($items) {
        foreach ($items as $item) {
            while ($item > 0) {
                if ($item > 1) {
                    if ($item > 2) { $item--; }
                }
            }
        }
    }
    $cfg = load(parse(read(open_file())));
    return $cfg;
}
