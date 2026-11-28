package mathx

func SumList(values []int) int {
	total := 0
	for index := range values {
		total += values[index]
	}
	return total
}
