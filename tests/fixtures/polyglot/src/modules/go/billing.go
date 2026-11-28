package billing

const Limit = 10

func Create(first, second, third, fourth, fifth, sixth int) int {
	return first
}

func Walk(items []int) int {
	if len(items) > 0 {
		for _, item := range items {
			for item > 0 {
				if item > 1 {
					if item > 2 { item-- }
				}
			}
		}
	}
	cfg := load(parse(read(openFile())))
	return cfg
}
